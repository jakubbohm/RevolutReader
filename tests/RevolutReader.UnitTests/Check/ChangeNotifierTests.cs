using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Check;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using RevolutReader.UnitTests.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// Sending a change to every allowed account (c014 design.md D5, D15; § Public API sketch, <see cref="ChangeNotifier"/>):
/// the same message goes to every account on the allowlist, one at a time, in the order the list is written; an allowed
/// account with no registered device costs nothing more than its three zero counts; one <c>ChangeSent</c> line sums the
/// accounts and the devices reached, failed and removed. The sender is the real <see cref="SendPushHandler"/> over C8a's
/// in-memory device store; the push services are C8a's stub delivery, or a hand-written one that holds every push until the
/// test lets it through, so the test sees which push was handed over before another ended. The accounts and push
/// addresses are made up; device keys are generated as a browser makes them.
/// </summary>
public sealed class ChangeNotifierTests {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";
  private const string EVA = "eva@example.com";

  /// <summary>The made-up app address, <c>Push:Subject</c>, as the sender's own tests set it.</summary>
  private const string APP_ADDRESS = "https://app.example.net";

  /// <summary>The push settings the sender never reads when it sends: the keys are the delivery's business.</summary>
  private const string NOT_READ_WHEN_SENDING = "made up, not read by the sender";

  /// <summary>A made-up change, whatever its text: the notifier sends it as it is.</summary>
  private static readonly PushMessage _change = new("Zkušební změna 2f9a", "Zkušební zůstatek 7c3d");

  /// <summary>
  /// The allowlist names Petr, Lucie and Eva in that order, which is neither alphabetical nor the order their phones were
  /// registered in (Lucie, Eva, Petr). Each push is held until the test lets it through: while the first account's push is
  /// held, no other account's push has been handed over, and so on, one account after the other.
  /// </summary>
  [Test]
  public async Task A_change_goes_to_every_account_on_the_allowlist_one_at_a_time_in_the_lists_order() {
    PushDevice luciesPhone = Device(LUCIE);
    PushDevice evasPhone = Device(EVA);
    PushDevice petrsPhone = Device(PETR);
    PushDevice[] inTheListsOrder = [petrsPhone, luciesPhone, evasPhone];
    HeldPushDelivery delivery = new();
    ChangeNotifier notifier = await Notifier($"{PETR}, {LUCIE}, {EVA}", delivery, NullLogger<ChangeNotifier>.Instance, luciesPhone, evasPhone, petrsPhone);

    Task sending = notifier.Send(_change, CancellationToken.None);

    try {
      for (int accounts = 1; accounts <= inTheListsOrder.Length; accounts++) {
        await delivery.WaitUntilHandedOver(accounts, orUntil: sending);
        delivery.HandedOver.ShouldBe(inTheListsOrder.Take(accounts), $"the pushes handed over while account {accounts}'s is held: one per account so far, in the list's order");
        delivery.LetThrough(accounts - 1);
      }

      await sending;
    }
    finally {
      delivery.LetAllThrough();
    }

    delivery.HandedOver.ShouldBe(inTheListsOrder, "every account's device, once, in the list's order");
  }

  /// <summary>
  /// Petr, first on the allowlist, has no registered device; Lucie has one. Petr's account costs nothing more than its zero
  /// counts: no push for him, no failure, the send goes on to Lucie, and the summed counts are Lucie's alone.
  /// </summary>
  [Test]
  public async Task An_allowed_account_with_no_device_costs_nothing_more_than_its_zero_counts() {
    PushDevice luciesPhone = Device(LUCIE);
    StubPushDelivery delivery = new();
    CapturedLog log = new();
    ChangeNotifier notifier = await Notifier($"{PETR}, {LUCIE}", delivery, log, luciesPhone);

    await notifier.Send(_change, CancellationToken.None);

    delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([luciesPhone], "one push, Lucie's: none for Petr, who has no device");
    LogEntry sent = log.Entries.Where(static line => line.EventName == "ChangeSent").ShouldHaveSingleItem();
    sent.CountsWithoutAccounts().ShouldBe(["delivered=1", "failed=0", "removed=0"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "Lucie's counts, and Petr's zeros");
  }

  /// <summary>
  /// Three allowed accounts: Lucie with a phone reached and a tablet gone, Petr with a phone whose push service fails and a
  /// tablet reached, Eva with no device. The one <c>ChangeSent</c> line, at Information, counts the three accounts and sums
  /// their devices: two reached, one failed, one removed.
  /// </summary>
  /// <summary>
  /// Lucie's address is on the allowlist twice, once in another letter case, with Petr's between (review finding 7 on PR
  /// #88): the allowlist compares addresses ignoring case, so it is one account, and the change reaches each of its devices
  /// once (spec account-check, "Every allowed account with a registered device gets the notification": one notification
  /// per device). Lucie's one phone is handed exactly one push, and the one <c>ChangeSent</c> line counts the two distinct
  /// accounts.
  /// </summary>
  [Test]
  public async Task An_account_listed_twice_on_the_allowlist_in_another_letter_case_gets_the_change_once_per_device() {
    PushDevice luciesPhone = Device(LUCIE);
    StubPushDelivery delivery = new();
    CapturedLog log = new();
    ChangeNotifier notifier = await Notifier($"{LUCIE}, {PETR}, {LUCIE.ToUpperInvariant()}", delivery, log, luciesPhone);

    await notifier.Send(_change, CancellationToken.None);

    LogEntry sent = log.Entries.Where(static line => line.EventName == "ChangeSent").ShouldHaveSingleItem("one line of what the change reached");
    delivery.HandedOver.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([luciesPhone], "one push to Lucie's phone, however often her address is listed"),
      () => sent.NamedValues().ShouldBe(["accounts=2", "delivered=1", "failed=0", "removed=0"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "two distinct accounts; Lucie's phone reached once"));
  }

  [Test]
  public async Task ChangeSent_sums_the_accounts_and_the_devices_reached_failed_and_removed() {
    PushDevice luciesPhone = Device(LUCIE);
    PushDevice luciesTablet = Device(LUCIE);
    PushDevice petrsPhone = Device(PETR);
    PushDevice petrsTablet = Device(PETR);
    StubPushDelivery delivery = new StubPushDelivery()
      .Answers(luciesTablet, new DeviceGone(410))
      .Answers(petrsPhone, new DeliveryFailed(500));
    CapturedLog log = new();
    ChangeNotifier notifier = await Notifier($"{LUCIE}, {PETR}, {EVA}", delivery, log, luciesPhone, luciesTablet, petrsPhone, petrsTablet);

    await notifier.Send(_change, CancellationToken.None);

    LogEntry sent = log.Entries.Where(static line => line.EventName == "ChangeSent").ShouldHaveSingleItem("one line of what the change reached");
    sent.ShouldSatisfyAllConditions(
      () => sent.Level.ShouldBe(LogLevel.Information),
      () => sent.NamedValues().ShouldBe(["accounts=3", "delivered=2", "failed=1", "removed=1"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "three accounts; their devices summed"));
  }

  /// <summary>
  /// The notifier under test: the allowlist <paramref name="allowlist"/>; the real sender over an in-memory device store
  /// holding <paramref name="devices"/>, handing its pushes to <paramref name="delivery"/>; the notifier's lines to
  /// <paramref name="logger"/>.
  /// </summary>
  private static async Task<ChangeNotifier> Notifier(string allowlist, IPushDelivery delivery, ILogger<ChangeNotifier> logger, params PushDevice[] devices) {
    InMemoryPushDeviceStore store = new();

    foreach (PushDevice device in devices)
      await store.Save(device, CancellationToken.None);

    Allowlist accounts = Allowlist.Parse(allowlist);
    SendPushHandler sender = new(store, delivery, accounts, Options.Create(new PushOptions {
      VapidPublicKey = NOT_READ_WHEN_SENDING,
      VapidPrivateKey = NOT_READ_WHEN_SENDING,
      MessageKey = NOT_READ_WHEN_SENDING,
      Subject = new Uri(APP_ADDRESS),
      Services = new Dictionary<string, string>(StringComparer.Ordinal) { ["Google"] = "https://fcm.googleapis.com" },
    }), NullLogger<SendPushHandler>.Instance);

    return new ChangeNotifier(accounts, sender, logger);
  }

  /// <summary>A device of <paramref name="account"/> at a made-up push address, with keys as a browser makes them (random here: nothing decrypts).</summary>
  private static PushDevice Device(string account) {
    byte[] point = RandomNumberGenerator.GetBytes(65);
    point[0] = 0x04;

    return new PushDevice(
      $"https://fcm.googleapis.com/fcm/send/made-up-{Guid.NewGuid():N}",
      Base64Url.EncodeToString(point),
      Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
      account);
  }

  /// <summary>
  /// The push services, holding every push handed over until the test lets it through (<see cref="LetThrough"/>), which it
  /// then answers as delivered; records the devices in the order handed over. Safe for calls from several threads at once.
  /// </summary>
  private sealed class HeldPushDelivery : IPushDelivery {
    /// <summary>How long <see cref="WaitUntilHandedOver"/> waits on the real clock: far longer than a send takes.</summary>
    private const int WITHIN_SECONDS = 10;

    private readonly Lock _lock = new();
    private readonly List<(PushDevice Device, TaskCompletionSource<DeliveryOutcome> Answer)> _handedOver = [];

    /// <summary>Set when the next push is handed over, then replaced by a new one.</summary>
    private TaskCompletionSource _next = NewSignal();

    /// <summary>The devices of the pushes handed over, in the order handed over.</summary>
    public IReadOnlyList<PushDevice> HandedOver {
      get {
        lock (_lock)
          return [.. _handedOver.Select(static handedOver => handedOver.Device)];
      }
    }

    public Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken) {
      TaskCompletionSource<DeliveryOutcome> answer = new(TaskCreationOptions.RunContinuationsAsynchronously);
      TaskCompletionSource next;

      lock (_lock) {
        _handedOver.Add((device, answer));
        next = _next;
        _next = NewSignal();
      }

      _ = next.TrySetResult();

      return answer.Task;
    }

    /// <summary>
    /// Waits until <paramref name="count"/> pushes have been handed over, or <paramref name="orUntil"/> has ended (so a send
    /// that stops short fails at once, not after the wait): a bounded wait on the real clock that wakes when a push is
    /// handed over, never a fixed pause. Neither within 10 s throws <see cref="TimeoutException"/>.
    /// </summary>
    public async Task WaitUntilHandedOver(int count, Task orUntil) {
      using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(WITHIN_SECONDS));

      while (true) {
        Task next;

        lock (_lock) {
          if (_handedOver.Count >= count)
            return;

          next = _next.Task;
        }

        if (orUntil.IsCompleted)
          return;

        try {
          _ = await Task.WhenAny(next, orUntil).WaitAsync(deadline.Token);
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested) {
          throw new TimeoutException($"Within {WITHIN_SECONDS} s, {HandedOver.Count} pushes were handed over, not {count}.");
        }
      }
    }

    /// <summary>Lets the push handed over at <paramref name="index"/> (0 for the first) through, answered as delivered.</summary>
    public void LetThrough(int index) {
      lock (_lock)
        _ = _handedOver[index].Answer.TrySetResult(new Delivered());
    }

    /// <summary>Lets every push handed over so far through, so nothing is left waiting after a test.</summary>
    public void LetAllThrough() {
      lock (_lock) {
        foreach ((_, TaskCompletionSource<DeliveryOutcome> answer) in _handedOver)
          _ = answer.TrySetResult(new Delivered());
      }
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
  }

  /// <summary>The notifier's logger, keeping every line it writes: its level, its event's name and its structured values.</summary>
  private sealed class CapturedLog : ILogger<ChangeNotifier> {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>Every line, in the order written.</summary>
    public IReadOnlyList<LogEntry> Entries {
      get {
        lock (_lock)
          return [.. _entries];
      }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
      LogEntry entry = new(logLevel, eventId.Name, [.. values]);

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>One line of the notifier's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>The line's own fields as <c>name=value</c>, without its message template, in the order the generator enumerates them.</summary>
    public IReadOnlyList<string> NamedValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => $"{pair.Key}={pair.Value}")];

    /// <summary>The device counts as <c>name=value</c>, without the accounts' count.</summary>
    public IReadOnlyList<string> CountsWithoutAccounts() => [.. NamedValues().Where(static value => !value.StartsWith("accounts=", StringComparison.OrdinalIgnoreCase))];

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}