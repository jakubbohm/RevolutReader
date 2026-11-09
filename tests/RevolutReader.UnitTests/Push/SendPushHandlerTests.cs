using System.Buffers.Text;
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

  [Test]
  public async Task The_answer_counts_the_devices_reached() {
    SendResult result = await Handler(await StoreWith(Device(LUCIE), Device(LUCIE), Device(LUCIE)), new StubPushDelivery()).Send(LUCIE, _message, CancellationToken.None);

    result.Value.ShouldBe(new PushSent(Delivered: 3, Failed: 0, Removed: 0));
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
    public IReadOnlyList<string> OwnNamedValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => $"{pair.Key}={pair.Value}")];

    /// <summary>The event's name, the message and every value, as one text.</summary>
    public string AllText() => string.Join(" | ", [EventName, Message, .. Values.Select(static pair => $"{pair.Key}={pair.Value}")]);

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}