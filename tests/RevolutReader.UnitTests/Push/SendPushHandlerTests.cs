using System.Buffers.Text;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Sending a message (spec push-sending, c011 design.md D2, D3, D4): to an account on the allowlist, every device stored
/// under it gets one push carrying the message's Declarative Web Push JSON, built on the app's own address
/// (<c>Push:Subject</c>); the answer counts the devices reached; the send logs one line of counts and nothing of the
/// message, the account or a device. The store is the in-memory fake, the push services a stub that delivers every push
/// and records it, the log a hand-written logger. The accounts, push addresses and texts are made up; device keys are
/// generated as a browser makes them.
/// </summary>
public sealed class SendPushHandlerTests {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";

  /// <summary>An account not on the sender's allowlist (which holds Lucie and Petr).</summary>
  private const string EVA = "eva@example.com";

  /// <summary>The made-up app address, <c>Push:Subject</c>: the base of every page a tap opens (D2, D5).</summary>
  private const string APP_ADDRESS = "https://app.example.net";

  /// <summary>The values sending never reads here: the keys are the delivery's business.</summary>
  private const string NOT_READ_WHEN_SENDING = "made up, not read by the sender";

  /// <summary>Distinctive texts, so none can turn up in a log line by coincidence.</summary>
  private static readonly PushMessage _message = new("Zkušební titulek 5c1e", "Zkušební zpráva 9d2a", "/transakce-7f3b");

  [Test]
  public async Task Every_device_of_an_allowed_account_gets_the_message_once() {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    StubPushDelivery delivery = new();

    _ = await Handler(await StoreWith(phone, tablet), delivery).Send(LUCIE, _message, CancellationToken.None);

    delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([phone, tablet], ignoreOrder: true, "one push for each of Lucie's devices, each device once");
  }

  [Test]
  public async Task Each_push_carries_the_messages_Declarative_Web_Push_JSON() {
    StubPushDelivery delivery = new();

    _ = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE)), delivery).Send(LUCIE, _message, CancellationToken.None);

    string declarativeJson = PushMessages.DeclarativeJson(_message, new Uri(APP_ADDRESS));
    delivery.HandedOver.ShouldNotBeEmpty();
    delivery.HandedOver.ShouldAllBe(handedOver => handedOver.Push.Content == declarativeJson, "every push carries the message as Declarative Web Push JSON on the app's address");
  }

  /// <summary>
  /// Every push waits up to 24 hours at the push service while the device is offline (D2: <c>TTL: 86400</c>). The value
  /// is written out here, not read from the sender, so a different lifetime (the library's default of four weeks, none,
  /// an hour) fails.
  /// </summary>
  [Test]
  public async Task Every_push_the_sender_hands_over_lives_24_hours() {
    StubPushDelivery delivery = new();

    _ = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE)), delivery).Send(LUCIE, _message, CancellationToken.None);

    delivery.HandedOver.Count.ShouldBe(2, "one push for each of Lucie's devices");
    delivery.HandedOver.ShouldAllBe(handedOver => handedOver.Push.Lifetime == TimeSpan.FromSeconds(86400), "every push lives 86400 seconds");
  }

  /// <summary>Every push is sent as urgent (D2: <c>Urgency: high</c>), not of the normal urgency a push has by default.</summary>
  [Test]
  public async Task Every_push_the_sender_hands_over_is_urgent() {
    StubPushDelivery delivery = new();

    _ = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE)), delivery).Send(LUCIE, _message, CancellationToken.None);

    delivery.HandedOver.Count.ShouldBe(2, "one push for each of Lucie's devices");
    delivery.HandedOver.ShouldAllBe(handedOver => handedOver.Push.Urgency == PushUrgency.High, "every push is urgent");
  }

  [Test]
  public async Task The_answer_counts_the_devices_reached() {
    SendResult result = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE), Device(LUCIE)), new StubPushDelivery()).Send(LUCIE, _message, CancellationToken.None);

    result.Value.ShouldBe(new PushSent(Delivered: 3, Failed: 0, Removed: 0));
  }

  /// <summary>
  /// Petr is on the allowlist and has registered no device, while Lucie has: a message to Petr is no error, it hands no
  /// push over and answers three zeros (D3). Lucie's devices sit in the store, so the zeros come from filtering by account,
  /// not from an empty store.
  /// </summary>
  [Test]
  public async Task An_allowed_account_with_no_devices_gets_zero_counts_and_no_push_is_handed_over() {
    StubPushDelivery delivery = new();

    SendResult result = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE)), delivery).Send(PETR, _message, CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => result.Value.ShouldBe(new PushSent(Delivered: 0, Failed: 0, Removed: 0)),
      () => delivery.HandedOver.ShouldBeEmpty("Petr has no device, and Lucie's get nothing"));
  }

  /// <summary>
  /// Only the named account's devices get the message (D3): not Petr's, also allowed, and not those of accounts whose
  /// addresses merely contain Lucie's, at either end (whole addresses, as the allowlist compares them).
  /// </summary>
  [Test]
  public async Task A_message_goes_only_to_the_devices_of_the_account_it_names() {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    StubPushDelivery delivery = new();
    InMemoryPushDeviceStore store = await StoreWith(
      phone, Device(PETR), tablet, Device($"not.{LUCIE}"), Device($"{LUCIE}.cz"));

    SendResult result = await Handler(store, delivery).Send(LUCIE, _message, CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([phone, tablet], ignoreOrder: true, "Lucie's phone and tablet, and no other account's device"),
      () => result.Value.ShouldBe(new PushSent(Delivered: 2, Failed: 0, Removed: 0)));
  }

  /// <summary>
  /// The account a device was registered under and the account a message names are compared ignoring letter case (D3,
  /// as the allowlist compares them), whichever side differs; another account's device still gets nothing.
  /// </summary>
  [Test]
  [Arguments("Lucie@Example.COM", LUCIE)] // the device registered under the address as the sign-in wrote it
  [Arguments(LUCIE, "LUCIE@EXAMPLE.COM")] // the message names the account in capitals
  public async Task Devices_are_matched_to_the_account_ignoring_letter_case(string registeredUnder, string messageTo) {
    PushDevice phone = Device(registeredUnder);
    PushDevice tablet = Device(registeredUnder);
    StubPushDelivery delivery = new();

    SendResult result = await Handler(await StoreWith(phone, Device(PETR), tablet), delivery).Send(messageTo, _message, CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([phone, tablet], ignoreOrder: true, "both of Lucie's devices, whatever the letter case, and not Petr's"),
      () => result.Value.ShouldBe(new PushSent(Delivered: 2, Failed: 0, Removed: 0)));
  }

  /// <summary>
  /// A send that reaches both devices writes one line, <c>PushSent</c> at Information, whose values are the three counts
  /// (reached, failed, removed) and nothing else: no title, text or page, no account, no push address or key (D4). The
  /// counts are read by name, as the sketch's <c>PushLog.PushSent</c> names them (<c>delivered</c>, <c>failed</c>,
  /// <c>removed</c>), in whatever order and casing the logging source generator writes them.
  /// </summary>
  [Test]
  public async Task A_send_logs_its_counts_only() {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    CapturedLog log = new();

    _ = await Handler(await StoreWith(phone, tablet), new StubPushDelivery(), log).Send(LUCIE, _message, CancellationToken.None);

    LogEntry line = log.Entries.ShouldHaveSingleItem("the send's lines: one, its counts");
    string[] privateValues = [
      _message.Title, _message.Text!, _message.Page, LUCIE,
      phone.Endpoint, phone.P256dh, phone.Auth, tablet.Endpoint, tablet.P256dh, tablet.Auth,
    ];
    line.ShouldSatisfyAllConditions(
      () => line.EventName.ShouldBe("PushSent"),
      () => line.Level.ShouldBe(LogLevel.Information),
      () => line.OwnNamedValues().ShouldBe(["delivered=2", "failed=0", "removed=0"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "the line's values: the three counts, by name"),
      () => privateValues.Where(value => line.AllText().Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty("nothing of the message, the account or a device in the line"));
  }

  /// <summary>
  /// Eva is not on the allowlist (Lucie and Petr are), yet a device is still stored under her account: a message to her is
  /// refused, and no push is handed over, neither to her device nor to anyone else's (D3). What becomes of her device is
  /// slice 8's.
  /// </summary>
  [Test]
  public async Task A_message_to_an_account_not_on_the_allowlist_is_refused_and_nothing_is_handed_over() {
    StubPushDelivery delivery = new();

    SendResult result = await Handler(await StoreWith(Device(EVA), Device(LUCIE), Device(PETR)), delivery).Send(EVA, _message, CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => result.Value.ShouldBeOfType<AccountNotAllowed>("Eva is not on the allowlist"),
      () => delivery.HandedOver.ShouldBeEmpty("a refused message hands no push over"));
  }

  /// <summary>
  /// The refusal writes its line, <c>PushAccountNotAllowed</c> at Warning (D4), and no line of the send names the refused
  /// account, in any letter case, or holds anything of the message. The line's count is slice 8's (24.3), so it is not read.
  /// </summary>
  [Test]
  public async Task A_refused_account_is_logged_without_its_address() {
    CapturedLog log = new();

    _ = await Handler(await StoreWith(Device(EVA)), new StubPushDelivery(), log).Send(EVA, _message, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    string[] privateValues = [EVA, _message.Title, _message.Text!, _message.Page];
    lines.ShouldSatisfyAllConditions(
      () => lines.ShouldContain(line => line.EventName == "PushAccountNotAllowed" && line.Level == LogLevel.Warning, "the refusal's line, at Warning"),
      () => lines.Where(line => privateValues.Any(value => line.AllText().Contains(value, StringComparison.OrdinalIgnoreCase))).ShouldBeEmpty("no line names the account or holds the message"));
  }

  /// <summary>
  /// Eva has left the allowlist while two devices are still stored under her account: a message to her deletes both
  /// (D3), so neither can get a push again.
  /// </summary>
  [Test]
  public async Task A_message_to_an_account_not_on_the_allowlist_deletes_the_devices_still_registered_under_it() {
    InMemoryPushDeviceStore store = await StoreWith(Device(EVA), Device(EVA));

    _ = await Handler(store, new StubPushDelivery()).Send(EVA, _message, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBeEmpty("Eva's two devices are deleted");
  }

  /// <summary>
  /// The refused account's devices are matched as the allowlist compares accounts, whole addresses ignoring letter case
  /// (D3), whichever side differs: both of Eva's devices go. Lucie's and Petr's devices stay, and so does the device of an
  /// account whose address merely contains Eva's, though it is not on the allowlist either: it is another account.
  /// </summary>
  [Test]
  [Arguments("Eva@Example.COM", EVA)] // the devices registered under the address as the sign-in wrote it
  [Arguments(EVA, "EVA@EXAMPLE.COM")] // the message names the account in capitals
  public async Task Those_devices_are_matched_ignoring_letter_case_and_other_accounts_devices_stay(string registeredUnder, string messageTo) {
    PushDevice lucies = Device(LUCIE);
    PushDevice petrs = Device(PETR);
    PushDevice lookalikes = Device($"not.{EVA}");
    InMemoryPushDeviceStore store = await StoreWith(Device(registeredUnder), lucies, Device(registeredUnder), petrs, lookalikes);

    _ = await Handler(store, new StubPushDelivery()).Send(messageTo, _message, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe([lucies, petrs, lookalikes], ignoreOrder: true, "Eva's devices deleted in any letter case; every other account's kept");
  }

  /// <summary>
  /// The refusal's line, <c>PushAccountNotAllowed</c> at Warning (D4), carries how many devices it deleted, read by name
  /// (<c>removed</c>, as the sketch's <c>PushLog.PushAccountNotAllowed</c> names it), and nothing else of its own.
  /// </summary>
  [Test]
  public async Task The_number_of_deleted_devices_is_logged() {
    CapturedLog log = new();

    _ = await Handler(await StoreWith(Device(EVA), Device(LUCIE), Device(EVA)), new StubPushDelivery(), log).Send(EVA, _message, CancellationToken.None);

    LogEntry line = log.Entries.Where(static entry => entry.EventName == "PushAccountNotAllowed").ShouldHaveSingleItem("the refusal's line");
    line.ShouldSatisfyAllConditions(
      () => line.Level.ShouldBe(LogLevel.Warning),
      () => line.OwnNamedValues().ShouldBe(["removed=2"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "the line's value: the two deleted devices, by name"));
  }

  /// <summary>
  /// A message the rules refuse (here a blank title, D10) is a caller's bug, never an expected outcome: the sender throws
  /// <see cref="ArgumentException"/> (§ Error model) and hands no push over, though Lucie is allowed and has devices.
  /// </summary>
  [Test]
  public async Task The_sender_refuses_a_message_the_rules_refuse_with_an_argument_error() {
    StubPushDelivery delivery = new();
    SendPushHandler sender = Handler(await StoreWith(Device(LUCIE), Device(LUCIE)), delivery);
    PushMessage blankTitle = _message with { Title = "   " };

    _ = await Should.ThrowAsync<ArgumentException>(() => sender.Send(LUCIE, blankTitle, CancellationToken.None));

    delivery.HandedOver.ShouldBeEmpty("a refused message is sent to no device");
  }

  /// <summary>
  /// A device whose push service answers that it is gone (404 or 410, D3) is forgotten at once and counted as removed, not
  /// as failed; the account's other device is kept and counted as reached.
  /// </summary>
  /// <param name="status">The push service's answer for a device that is gone.</param>
  [Test]
  [Arguments(404)]
  [Arguments(410)]
  public async Task A_device_the_push_service_reports_gone_is_forgotten_and_counted_as_removed(int status) {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    InMemoryPushDeviceStore store = await StoreWith(phone, tablet);
    StubPushDelivery delivery = new StubPushDelivery().Answers(phone, new DeviceGone(status));

    SendResult result = await Handler(store, delivery).Send(LUCIE, _message, CancellationToken.None);
    IReadOnlyList<PushDevice> kept = await store.ReadAll(CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => result.Value.ShouldBe(new PushSent(Delivered: 1, Failed: 0, Removed: 1)),
      () => kept.ShouldBe([tablet], "the gone phone is forgotten, the tablet kept"));
  }

  /// <summary>
  /// A gone device writes its line, <c>PushDeviceGone</c> at Information (D4), whose one value is the push service's
  /// status, read by name (<c>status</c>, as the sketch's <c>PushLog.PushDeviceGone</c> names it); no line of the send holds
  /// the device's push address or keys, the account or the message.
  /// </summary>
  [Test]
  public async Task A_gone_device_is_logged_with_the_status_only() {
    PushDevice phone = Device(LUCIE);
    CapturedLog log = new();

    _ = await Handler(await StoreWith(phone, Device(LUCIE)), new StubPushDelivery().Answers(phone, new DeviceGone(410)), log).Send(LUCIE, _message, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    string[] privateValues = [phone.Endpoint, phone.P256dh, phone.Auth, LUCIE, _message.Title, _message.Text!, _message.Page];
    lines.ShouldSatisfyAllConditions(
      () => {
        LogEntry gone = lines.Where(static line => line.EventName == "PushDeviceGone").ShouldHaveSingleItem("one line for the one gone device");
        gone.Level.ShouldBe(LogLevel.Information);
        gone.OwnNamedValues().ShouldBe(["status=410"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "the line's value: the status, by name");
      },
      () => lines.Where(line => privateValues.Any(value => line.AllText().Contains(value, StringComparison.OrdinalIgnoreCase))).ShouldBeEmpty("nothing of the device, the account or the message in any line"));
  }

  /// <summary>
  /// The account's other devices still get the message when one is gone, also when the gone one comes first: each gets its
  /// push once and is counted as reached, and both stay stored.
  /// </summary>
  [Test]
  public async Task The_other_devices_of_the_account_still_get_the_message() {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    PushDevice laptop = Device(LUCIE);
    InMemoryPushDeviceStore store = await StoreWith(phone, tablet, laptop);
    StubPushDelivery delivery = new StubPushDelivery().Answers(phone, new DeviceGone(410));

    SendResult result = await Handler(store, delivery).Send(LUCIE, _message, CancellationToken.None);
    IReadOnlyList<PushDevice> kept = await store.ReadAll(CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.Select(static handedOver => handedOver.Device).Where(device => device != phone).ShouldBe([tablet, laptop], ignoreOrder: true, "the tablet and the laptop each get the message once"),
      () => result.Value.ShouldBe(new PushSent(Delivered: 2, Failed: 0, Removed: 1)),
      () => kept.ShouldBe([tablet, laptop], ignoreOrder: true, "the other devices stay"));
  }

  /// <summary>
  /// A push that fails for any other reason (another status such as 429, 413 or a 5xx, or no answer at all, D3) is counted
  /// as failed, and the device is kept: it may work next time. The account's other device is reached.
  /// </summary>
  /// <param name="status">The push service's answer, or <see langword="null"/> when none came (timeout, no connection).</param>
  [Test]
  [Arguments(429)]
  [Arguments(413)]
  [Arguments(500)]
  [Arguments(503)]
  [Arguments(null)]
  public async Task A_device_whose_push_fails_is_counted_as_failed_and_kept(int? status) {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    InMemoryPushDeviceStore store = await StoreWith(phone, tablet);

    SendResult result = await Handler(store, new StubPushDelivery().Answers(phone, new DeliveryFailed(status))).Send(LUCIE, _message, CancellationToken.None);
    IReadOnlyList<PushDevice> kept = await store.ReadAll(CancellationToken.None);

    result.ShouldSatisfyAllConditions(
      () => result.Value.ShouldBe(new PushSent(Delivered: 1, Failed: 1, Removed: 0)),
      () => kept.ShouldBe([phone, tablet], ignoreOrder: true, "the failing phone is kept"));
  }

  /// <summary>
  /// A failed push writes its line, <c>PushDeliveryFailed</c> at Warning (D4), whose one value, read by name
  /// (<c>status</c>, as the sketch's <c>PushLog.PushDeliveryFailed</c> names it), is the push service's status, or none
  /// when no answer came: then the value is empty, as .NET's logging writes a missing value (no value, an empty text or
  /// <c>(null)</c>), never a made-up number. No line of the send holds the device's push address or keys, the account or
  /// the message.
  /// </summary>
  /// <param name="status">The push service's answer, or <see langword="null"/> when none came.</param>
  [Test]
  [Arguments(500)]
  [Arguments(null)]
  public async Task A_failed_push_is_logged_with_its_status_or_none_when_no_answer_came(int? status) {
    PushDevice phone = Device(LUCIE);
    CapturedLog log = new();

    _ = await Handler(await StoreWith(phone, Device(LUCIE)), new StubPushDelivery().Answers(phone, new DeliveryFailed(status)), log).Send(LUCIE, _message, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    string[] privateValues = [phone.Endpoint, phone.P256dh, phone.Auth, LUCIE, _message.Title, _message.Text!, _message.Page];
    lines.ShouldSatisfyAllConditions(
      () => {
        LogEntry failed = lines.Where(static line => line.EventName == "PushDeliveryFailed").ShouldHaveSingleItem("one line for the one failed push");
        failed.Level.ShouldBe(LogLevel.Warning);
        KeyValuePair<string, object?> value = failed.OwnValues().ShouldHaveSingleItem("the line's one value: the status");
        value.Key.ShouldBe("status", StringCompareShould.IgnoreCase);

        if (status is int answered)
          value.Value?.ToString().ShouldBe(answered.ToString(CultureInfo.InvariantCulture), "the push service's status");
        else
          (value.Value?.ToString() ?? string.Empty).ShouldBeOneOf([string.Empty, "(null)"], "no status when no answer came");
      },
      () => lines.Where(line => privateValues.Any(value => line.AllText().Contains(value, StringComparison.OrdinalIgnoreCase))).ShouldBeEmpty("nothing of the device, the account or the message in any line"));
  }

  /// <summary>
  /// Nothing is retried (D3): a failed push is handed over once, whatever the failure, and the send ends; the caller can
  /// send again.
  /// </summary>
  /// <param name="status">The push service's answer, or <see langword="null"/> when none came.</param>
  [Test]
  [Arguments(429)]
  [Arguments(503)]
  [Arguments(null)]
  public async Task A_failed_push_is_not_handed_over_again(int? status) {
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    StubPushDelivery delivery = new StubPushDelivery().Answers(phone, new DeliveryFailed(status));

    _ = await Handler(await StoreWith(phone, tablet), delivery).Send(LUCIE, _message, CancellationToken.None);

    delivery.HandedOver.Select(static handedOver => handedOver.Device).ShouldBe([phone, tablet], ignoreOrder: true, "one push to each device, the failing phone's not handed over again");
  }

  private static SendPushHandler Handler(IPushDeviceStore store, IPushDelivery delivery, ILogger<SendPushHandler>? logger = null) =>
    new(store, delivery, Allowlist.Parse($"{LUCIE}, {PETR}"), Options.Create(new PushOptions {
      VapidPublicKey = NOT_READ_WHEN_SENDING,
      VapidPrivateKey = NOT_READ_WHEN_SENDING,
      MessageKey = NOT_READ_WHEN_SENDING,
      Subject = new Uri(APP_ADDRESS),
      Services = new Dictionary<string, string>(StringComparer.Ordinal) { ["Google"] = "https://fcm.googleapis.com" },
    }), logger ?? new CapturedLog());

  private static async Task<InMemoryPushDeviceStore> StoreWith(params PushDevice[] devices) {
    InMemoryPushDeviceStore store = new();

    foreach (PushDevice device in devices)
      await store.Save(device, CancellationToken.None);

    return store;
  }

  /// <summary>A device of <paramref name="account"/> at a made-up push address, with keys as a browser makes them (random here: the stub never decrypts).</summary>
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
  /// The sender's logger, keeping every line it writes: its level, its event's name, its structured values and its
  /// message. A source-generated line's values are its own fields and its message template.
  /// </summary>
  private sealed class CapturedLog : ILogger<SendPushHandler> {
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
      ArgumentNullException.ThrowIfNull(formatter);

      IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
      LogEntry entry = new(logLevel, eventId.Name, [.. values], formatter(state, exception));

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>One line of the sender's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values, string Message) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>
    /// The line's own fields as <c>name=value</c>, without its message template, in the order the logging source generator
    /// enumerates them, which need not be the method's parameter order (this project's generator writes them reversed).
    /// </summary>
    public IReadOnlyList<string> OwnNamedValues() => [.. OwnValues().Select(static pair => $"{pair.Key}={pair.Value}")];

    /// <summary>The line's own fields, without its message template, as the logging source generator enumerates them.</summary>
    public IReadOnlyList<KeyValuePair<string, object?>> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT)];

    /// <summary>The event's name, the message and every value, as one text.</summary>
    public string AllText() => string.Join(" | ", [EventName, Message, .. Values.Select(static pair => $"{pair.Key}={pair.Value}")]);

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}