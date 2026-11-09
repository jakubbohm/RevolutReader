using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// Push's log lines (c011 design.md D4; CLAUDE.md: no email address in any log line): counts and outcomes only. Nothing the
/// app copy logs while devices register, a registration is refused, a message is sent (one device reached, one its push
/// service reports gone, one whose push service fails once), a message goes to an account that left the allowlist, and a
/// device is forgotten, holds:
/// <list type="bullet">
/// <item>a device's keys (<c>p256dh</c>, <c>auth</c>), the VAPID pair or the message key;</item>
/// <item>an email address: the signed-in account's, the message's target's;</item>
/// <item>the message's title or text;</item>
/// <item>a device's push address, outside the push client's own request lines: the framework's request logging of the
/// push client's <see cref="HttpClient"/> (category <c>System.Net.Http.HttpClient.IPushDelivery.*</c>) keeps the request's
/// URL, accepted by the owner (D4, 2026-11-09). Those lines may name the push address, never a key.</item>
/// </list>
/// The test first checks that the four lines of <c>PushLog</c> were written (<c>PushSent</c>, <c>PushDeliveryFailed</c>,
/// <c>PushDeviceGone</c>, <c>PushAccountNotAllowed</c>), so it cannot pass without them. Exported traces are not read: the
/// push client's traces keep the push address by the same decision (D4).
/// <para>
/// A rule, not a scenario: no public channel shows logs. What counts is what the app copy itself logs, through the logging
/// levels of its own <c>appsettings.json</c>, as in <see cref="SignInTelemetryTests"/>: a logger provider in the app copy's
/// container receives every entry the app's filters let through, with its level, event name, message, structured values,
/// scopes and exception. It sees only this app copy's loggers, so tests running in parallel do not mix in.
/// </para>
/// <para>
/// The values looked for are distinctive: the devices' keys, the VAPID pair and the message key are random base64url made
/// up per test or run; a push address is looked for by its device's own segment, a new GUID; the title and text carry
/// marks no other text holds; the former account is the guard's own made-up address.
/// </para>
/// </summary>
public sealed class PushTelemetryTests : AcceptanceTest {
  /// <summary>Push's events (design.md § Public API sketch, <c>PushLog</c>).</summary>
  private const string PUSH_SENT = "PushSent";
  private const string PUSH_DELIVERY_FAILED = "PushDeliveryFailed";
  private const string PUSH_DEVICE_GONE = "PushDeviceGone";
  private const string PUSH_ACCOUNT_NOT_ALLOWED = "PushAccountNotAllowed";

  /// <summary>
  /// How the categories of the push client's own request lines start: the framework's logging of a typed client, named
  /// after its interface (<c>AddHttpClient&lt;IPushDelivery, WebPushDelivery&gt;</c>), under <c>LogicalHandler</c> and
  /// <c>ClientHandler</c>.
  /// </summary>
  private const string PUSH_CLIENT_CATEGORY = $"System.Net.Http.HttpClient.{nameof(IPushDelivery)}.";

  /// <summary>The message's title and text (made up), each with a mark of its own.</summary>
  private const string TITLE = "Hlídka-titulek-4c9e";
  private const string TEXT = "Hlídka-text-8d21: zaplaceno 4 821,37 CZK";

  /// <summary>An account that has left the allowlist with a device still registered (made up, the guard's own).</summary>
  private const string FORMER_ACCOUNT = "hlidka.byvaly.ucet@example.com";

  /// <summary>A secret one byte short of a browser's (RFC 8291 § 3.2), so the registration is refused.</summary>
  private const int SHORT_SECRET_BYTES = 15;

  private readonly CapturedLogs _logs = new();

  [Test]
  public async Task A_registration_and_a_send_log_no_key_email_title_or_text_and_no_push_address_outside_the_push_clients_request_lines() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    TestDevice reached = FakePushService.NewDevice("Hlídka: telefon");
    TestDevice gone = FakePushService.NewDevice("Hlídka: tablet");
    TestDevice failing = FakePushService.NewDevice("Hlídka: notebook");
    TestDevice refused = FakePushService.NewDevice("Hlídka: odmítnutý");
    TestDevice former = FakePushService.NewDevice("Hlídka: bývalý účet");

    foreach (TestDevice device in (TestDevice[])[reached, gone, failing])
      (await PushDriver.Register(device)).ShouldBe(RegistrationAnswer.Registered, $"registering {device.Name}");
    (await PushDriver.RegisterWithSecretOfBytes(refused, SHORT_SECRET_BYTES)).ShouldNotBe(RegistrationAnswer.Registered, "a registration with a short secret");
    FakePushService.Gone(gone);
    FakePushService.FailsOnce(failing);

    (await PushDriver.SendMessage(Visitor.Lucie.Email, TITLE, TEXT, page: null))
      .ShouldBe(MessageAnswer.Counts(delivered: 1, failed: 1, removed: 1), "the message to Lucie's three devices");

    await PushDriver.SaveDeviceFor(former, FORMER_ACCOUNT);
    (await PushDriver.SendMessage(FORMER_ACCOUNT, TITLE, TEXT, page: null))
      .ShouldBe(MessageAnswer.Refused(ProblemDescription.PushAccountNotAllowed), "the message to an account that left the allowlist");

    (await PushDriver.Forget(reached)).ShouldBe(ForgetAnswer.Forgotten, "forgetting the device reached");

    string[] pushLines = [PUSH_SENT, PUSH_DELIVERY_FAILED, PUSH_DEVICE_GONE, PUSH_ACCOUNT_NOT_ALLOWED];
    pushLines.Except(_logs.EventNames(), StringComparer.Ordinal).ShouldBeEmpty("Push's lines not written, so the guard would not read them");

    TestDevice[] devices = [reached, gone, failing, refused, former];
    (string What, string Value)[] anywhere = [
      .. devices.Select(static device => ($"{device.Name}'s p256dh", device.P256dh)),
      .. devices.Select(static device => ($"{device.Name}'s auth", device.Auth)),
      ("the VAPID public key", FakePushService.VapidPublicKey),
      ("the VAPID private key", FakePushService.VapidPrivateKey),
      ("the message key", FakePushService.MessageKey),
      ("Lucie's email", Visitor.Lucie.Email),
      ("the former account's email", FORMER_ACCOUNT),
      ("the title", TITLE),
      ("the text", TEXT),
    ];
    (string What, string Value)[] outsideThePushClient = [.. devices.Select(static device => ($"{device.Name}'s push address", DeviceSegment(device)))];

    _logs.Leaks(anywhere, outsideThePushClient)
      .ShouldBeEmpty("Log messages, structured values, scope values or exceptions naming a key, an email, the title or the text, or a push address outside the push client's own request lines");
  }

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));

  /// <summary>The device's own segment of its push address (the last, a new GUID): what makes the address the device's.</summary>
  private static string DeviceSegment(TestDevice device) => device.PushAddress.Segments[^1];

  /// <summary>Whether the entry is one of the push client's own request lines (D4).</summary>
  private static bool IsThePushClients(LogEntry entry) => entry.Category.StartsWith(PUSH_CLIENT_CATEGORY, StringComparison.Ordinal);

  /// <summary>
  /// One log entry of the app copy (<see cref="CapturingLoggerProvider"/>): its category, level and event's name, and all
  /// its text.
  /// </summary>
  private sealed record LogEntry(string Category, LogLevel Level, string? EventName, IReadOnlyList<string> Texts) {
    /// <summary>For a failure message: the level, the event, the category.</summary>
    public override string ToString() => $"{Level} {EventName} ({Category})";
  }

  /// <summary>Every log entry of the app copy, in the order logged.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>The event names logged, each once.</summary>
    public IReadOnlyList<string> EventNames() {
      lock (_lock)
        return [.. _entries.Select(static entry => entry.EventName).OfType<string>().Distinct(StringComparer.Ordinal)];
    }

    /// <summary>
    /// For each entry holding a value of <paramref name="anywhere"/>, or, unless it is the push client's own request line,
    /// of <paramref name="outsideThePushClient"/>: what it holds and the entry, never the value itself.
    /// </summary>
    public List<string> Leaks(IReadOnlyList<(string What, string Value)> anywhere, IReadOnlyList<(string What, string Value)> outsideThePushClient) {
      List<string> leaks = [];

      lock (_lock) {
        foreach (LogEntry entry in _entries) {
          IEnumerable<(string What, string Value)> forbidden = IsThePushClients(entry) ? anywhere : [.. anywhere, .. outsideThePushClient];

          leaks.AddRange(forbidden
            .Where(value => entry.Texts.Any(text => text.Contains(value.Value, StringComparison.OrdinalIgnoreCase)))
            .Select(value => $"{value.What} in {entry}"));
        }
      }

      return leaks;
    }

    public void Add(LogEntry entry) {
      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>
  /// The app copy's logger provider writing into <see cref="CapturedLogs"/>: each entry's message, each structured value,
  /// each scope and its values, and the exception; the app copy's container owns it.
  /// </summary>
  private sealed class CapturingLoggerProvider(CapturedLogs logs) : ILoggerProvider, ISupportExternalScope {
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this, categoryName);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    private void Capture<TState>(string category, LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      List<string> texts = [formatter(state, exception)];

      AddValues(texts, state);

      if (exception is not null)
        texts.Add(exception.ToString());

      _scopes.ForEachScope(static (scope, list) => AddValues(list, scope), texts);

      logs.Add(new LogEntry(category, level, eventId.Name, texts));
    }

    private static void AddValues(List<string> texts, object? state) {
      if (state is null)
        return;

      texts.Add(state.ToString() ?? string.Empty);

      if (state is IEnumerable<KeyValuePair<string, object?>> values)
        texts.AddRange(values.Select(static pair => $"{pair.Key}={pair.Value}"));
    }

    private sealed class CapturingLogger(CapturingLoggerProvider provider, string category) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider._scopes.Push(state);

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        provider.Capture(category, logLevel, eventId, state, exception, formatter);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}