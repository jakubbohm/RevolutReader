using System.Buffers.Text;
using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The push settings are checked at start-up (c011 design.md D5, D9, D13; configuration.md § Binding): none of the three
/// secrets may still hold the declared placeholder; the VAPID public key is the 65-byte uncompressed P-256 point and the
/// private key the 32-byte scalar, each in base64url, and the two are one pair; the message key is at least 32 bytes;
/// <c>Subject</c> is an absolute https address with no path beyond "/", no query and no fragment; every known push service
/// is a valid pattern; the request timeout lies between 1 and 60 seconds. A failure names the setting, never its value.
/// Each test runs both checks the app runs at start: the settings' data annotations, as <c>ValidateDataAnnotations</c> runs
/// them, and <see cref="PushOptionsValidator"/>. Every value here is made up; every key is generated in the test.
/// </summary>
public sealed class PushOptionsTests {
  private const string PLACEHOLDER = "<secret>";

  /// <summary>Distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string PLAIN_TEXT = "plain text where the key should be, 3e81b7";

  /// <summary>The message key's least size (D5): 32 random bytes.</summary>
  private const int MESSAGE_KEY_BYTES = 32;

  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <summary>The made-up app address, an https origin of a reserved domain, as the acceptance tests' fake push service sets it.</summary>
  private static readonly Uri _subject = new("https://app.example.net");

  /// <summary>The default request timeout <c>PushOptions</c> declares (D13).</summary>
  private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(10);

  /// <summary>
  /// Known push services in each form an entry may take (D9): an https host, an https wildcard host, and plain http on a
  /// loopback host with a port, as the acceptance tests' fake push service is named.
  /// </summary>
  private static readonly Dictionary<string, string> _services = new(StringComparer.Ordinal) {
    ["Google"] = "https://fcm.googleapis.com",
    ["Apple"] = "https://*.push.apple.com",
    ["LocalFake"] = "http://127.0.0.1:5005",
  };

  /// <summary>
  /// Valid entries in the forms <see cref="_services"/> leaves out (D9): the root path "/", an explicit port, a wildcard
  /// with a port, and plain http on each loopback host.
  /// </summary>
  private static readonly Dictionary<string, string> _otherServiceForms = new(StringComparer.Ordinal) {
    ["RootPath"] = "https://updates.push.services.mozilla.com/",
    ["ExplicitPort"] = "https://fcm.googleapis.com:443",
    ["WildcardWithPort"] = "https://*.notify.windows.com:8443",
    ["LocalhostFake"] = "http://localhost:5005",
    ["IPv6LoopbackFake"] = "http://[::1]:5005",
  };

  private static readonly Lazy<VapidKeys> _vapidKeys = new(VapidKeys.New);

  private static readonly Lazy<string> _messageKey = new(static () => RandomBase64Url(MESSAGE_KEY_BYTES));

  /// <param name="variant">Complete settings, as made up for the tests, or with one value at an edge the rules allow.</param>
  [Test]
  [Arguments("made-up keys, the app's address and known services")]
  [Arguments("a subject with a port")]
  [Arguments("a message key longer than 32 bytes")]
  [Arguments("the shortest request timeout, 1 second")]
  [Arguments("the longest request timeout, 60 seconds")]
  [Arguments("known services in every other form an entry may take")]
  public void A_complete_set_of_push_settings_passes_validation(string variant) {
    PushOptions settings = variant switch {
      "made-up keys, the app's address and known services" => Settings(),
      "known services in every other form an entry may take" => Settings(services: _otherServiceForms),
      "a subject with a port" => Settings(subject: new Uri("https://localhost:5173")),
      "a message key longer than 32 bytes" => Settings(messageKey: RandomBase64Url(64)),
      "the shortest request timeout, 1 second" => Settings(requestTimeout: TimeSpan.FromSeconds(1)),
      "the longest request timeout, 60 seconds" => Settings(requestTimeout: TimeSpan.FromSeconds(60)),
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };

    Failures(settings).ShouldBeEmpty();
  }

  [Test]
  [Arguments(nameof(PushOptions.VapidPublicKey))]
  [Arguments(nameof(PushOptions.VapidPrivateKey))]
  [Arguments(nameof(PushOptions.MessageKey))]
  public void A_push_secret_still_holding_the_placeholder_fails_validation_and_the_message_names_the_setting_only(string setting) {
    PushOptions settings = setting switch {
      nameof(PushOptions.VapidPublicKey) => Settings(vapidPublicKey: PLACEHOLDER),
      nameof(PushOptions.VapidPrivateKey) => Settings(vapidPrivateKey: PLACEHOLDER),
      nameof(PushOptions.MessageKey) => Settings(messageKey: PLACEHOLDER),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not one of the three secrets."),
    };

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains("placeholder", StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} still holds the placeholder");
    failures.ShouldAllBe(failure => !QuotesAny(failure, PLACEHOLDER, settings.VapidPublicKey, settings.VapidPrivateKey, settings.MessageKey), "no failure message may contain a setting's value");
  }

  /// <param name="notAPoint">A value that is not the 65-byte uncompressed P-256 point in base64url (D5).</param>
  [Test]
  [Arguments("plain text")]
  [Arguments("the private key's 32 bytes")]
  [Arguments("a compressed point, 33 bytes")]
  [Arguments("65 bytes that are not a point on P-256, a damaged key")]
  [Arguments("the point in standard base64")]
  public void A_public_key_that_is_not_a_65_byte_P256_point_in_base64url_fails_validation_naming_the_setting_only(string notAPoint) {
    PushOptions settings = notAPoint switch {
      "plain text" => Settings(vapidPublicKey: PLAIN_TEXT),
      "the private key's 32 bytes" => Settings(vapidPublicKey: _vapidKeys.Value.PrivateKey),
      "a compressed point, 33 bytes" => Settings(vapidPublicKey: Base64Url.EncodeToString(_vapidKeys.Value.CompressedPoint)),
      "65 bytes that are not a point on P-256, a damaged key" => Settings(vapidPublicKey: Base64Url.EncodeToString(_vapidKeys.Value.PointOffTheCurve)),
      "the point in standard base64" => InStandardBase64(static keys => keys.Point, static keys => Settings(
        vapidPublicKey: Convert.ToBase64String(keys.Point), vapidPrivateKey: keys.PrivateKey)),
      _ => throw new ArgumentOutOfRangeException(nameof(notAPoint), notAPoint, "Not a known case."),
    };

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(failure => failure.Contains(nameof(PushOptions.VapidPublicKey), StringComparison.Ordinal), "a failure naming VapidPublicKey");
    failures.ShouldAllBe(failure => !QuotesAny(failure, settings.VapidPublicKey, settings.VapidPrivateKey, settings.MessageKey), "no failure message may contain a setting's value");
  }

  /// <param name="notAScalar">A value that is not 32 bytes in base64url (D5).</param>
  [Test]
  [Arguments("plain text")]
  [Arguments("the public key's 65 bytes")]
  [Arguments("31 bytes, the scalar without its first byte")]
  [Arguments("the scalar in standard base64")]
  public void A_private_key_that_is_not_32_bytes_in_base64url_fails_validation_naming_the_setting_only(string notAScalar) {
    PushOptions settings = notAScalar switch {
      "plain text" => Settings(vapidPrivateKey: PLAIN_TEXT),
      "the public key's 65 bytes" => Settings(vapidPrivateKey: _vapidKeys.Value.PublicKey),
      "31 bytes, the scalar without its first byte" => Settings(vapidPrivateKey: Base64Url.EncodeToString(_vapidKeys.Value.Scalar.AsSpan(1))),
      "the scalar in standard base64" => InStandardBase64(static keys => keys.Scalar, static keys => Settings(
        vapidPublicKey: keys.PublicKey, vapidPrivateKey: Convert.ToBase64String(keys.Scalar))),
      _ => throw new ArgumentOutOfRangeException(nameof(notAScalar), notAScalar, "Not a known case."),
    };

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(failure => failure.Contains(nameof(PushOptions.VapidPrivateKey), StringComparison.Ordinal), "a failure naming VapidPrivateKey");
    failures.ShouldAllBe(failure => !QuotesAny(failure, settings.VapidPublicKey, settings.VapidPrivateKey, settings.MessageKey), "no failure message may contain a setting's value");
  }

  /// <summary>Each half is well formed on its own; they come from two different keys, so the private one signs what the public one cannot verify (D5).</summary>
  [Test]
  public void Two_key_halves_that_are_not_one_pair_fail_validation() {
    VapidKeys one = VapidKeys.New();
    VapidKeys another = VapidKeys.New();
    PushOptions settings = Settings(vapidPublicKey: one.PublicKey, vapidPrivateKey: another.PrivateKey);

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(
      failure => failure.Contains(nameof(PushOptions.VapidPublicKey), StringComparison.Ordinal) && failure.Contains(nameof(PushOptions.VapidPrivateKey), StringComparison.Ordinal),
      "a failure naming both halves");
    failures.ShouldAllBe(failure => !QuotesAny(failure, settings.VapidPublicKey, settings.VapidPrivateKey, settings.MessageKey), "no failure message may contain a setting's value");
  }

  /// <param name="bytes">Fewer than the 32 random bytes the message key must have (D5).</param>
  [Test]
  [Arguments(31)]
  [Arguments(16)]
  public void A_message_key_shorter_than_32_bytes_fails_validation(int bytes) {
    PushOptions settings = Settings(messageKey: RandomBase64Url(bytes));

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(failure => failure.Contains(nameof(PushOptions.MessageKey), StringComparison.Ordinal), "a failure naming MessageKey");
    failures.ShouldAllBe(failure => !QuotesAny(failure, settings.VapidPublicKey, settings.VapidPrivateKey, settings.MessageKey), "no failure message may contain a setting's value");
  }

  /// <param name="subject">Not an absolute https address with no path beyond "/", no query and no fragment (D5).</param>
  [Test]
  [Arguments("https://app.example.net/push")] // a path: the base of every page a tap opens must be the app's root
  [Arguments("https://app.example.net/?from=push")] // a query
  [Arguments("https://app.example.net/#push")] // a fragment
  [Arguments("http://app.example.net")] // plain http
  [Arguments("http://localhost")] // plain http on this machine: the loopback exception is the push services' alone (D9)
  [Arguments("app.example.net")] // no scheme: binds as a relative address
  [Arguments("mailto:push@example.net")] // a contact the push services accept, but not the app's address
  public void A_subject_that_is_not_an_https_origin_fails_validation(string subject) =>
    Failures(Settings(subject: new Uri(subject, UriKind.RelativeOrAbsolute)))
      .ShouldContain(failure => failure.Contains(nameof(PushOptions.Subject), StringComparison.Ordinal), "a failure naming Subject");

  /// <param name="requestTimeout">Shorter than 1 second or longer than 60 (D13), as a TimeSpan setting reads.</param>
  [Test]
  [Arguments("00:00:00")]
  [Arguments("00:00:00.999")]
  [Arguments("00:01:00.001")]
  [Arguments("00:05:00")]
  public void A_request_timeout_outside_1_to_60_seconds_fails_validation(string requestTimeout) =>
    Failures(Settings(requestTimeout: TimeSpan.Parse(requestTimeout, CultureInfo.InvariantCulture)))
      .ShouldContain(failure => failure.Contains(nameof(PushOptions.RequestTimeout), StringComparison.Ordinal), "a failure naming RequestTimeout");

  /// <summary>
  /// A known push service is an origin (D9): https and a host, or https, "*." and a host suffix, with no user information,
  /// path, query or fragment; plain http only on a loopback host. An entry that is anything else fails validation, the
  /// message naming the setting and the entry, never its value; the other entries, all valid, are not named.
  /// </summary>
  /// <param name="pattern">Not a push service pattern (D9).</param>
  [Test]
  [Arguments("https://fcm.googleapis.com/fcm/send")] // a path
  [Arguments("https://fcm.googleapis.com/?from=settings")] // a query
  [Arguments("https://fcm.googleapis.com?from=settings")] // a query, no "/" before it
  [Arguments("https://fcm.googleapis.com/#push")] // a fragment
  [Arguments("https://push.*.apple.com")] // a wildcard in the middle
  [Arguments("https://*push.apple.com")] // a wildcard not followed by "."
  [Arguments("https://push.apple.com.*")] // a wildcard at the end
  [Arguments("https://*.*.apple.com")] // a second wildcard
  [Arguments("*.push.apple.com")] // a wildcard host with no scheme
  [Arguments("http://fcm.googleapis.com")] // plain http on a host that is not loopback
  [Arguments("http://*.push.apple.com")] // plain http with a wildcard
  [Arguments("http://10.0.0.4:5005")] // plain http on an address of the private network
  [Arguments("http://localhost.example.com:5005")] // plain http on a host that only starts like this machine's name
  [Arguments("https://user@fcm.googleapis.com")] // user information
  [Arguments("fcm.googleapis.com")] // no scheme
  [Arguments("ftp://fcm.googleapis.com")] // neither https nor http
  public void A_known_push_service_that_is_not_an_origin_pattern_fails_validation_naming_the_entry_only(string pattern) {
    const string entry = "Elsewhere5b2e";
    Dictionary<string, string> services = new(_services, StringComparer.Ordinal) { [entry] = pattern };

    IReadOnlyList<string> failures = Failures(Settings(services: services));

    failures.ShouldContain(
      failure => failure.Contains(nameof(PushOptions.Services), StringComparison.Ordinal) && failure.Contains(entry, StringComparison.Ordinal),
      "a failure naming the Services setting and the entry");
    failures.ShouldAllBe(failure => !QuotesAny(failure, pattern), "no failure message may contain the entry's value");
    string[] validEntries = [.. _services.Keys];
    failures.ShouldAllBe(failure => !QuotesAny(failure, validEntries), "no failure names an entry that is valid");
  }

  /// <summary>
  /// The services the app's own <c>appsettings.json</c> declares under <c>Push:Services</c> (D9), bound as the app binds
  /// the section, with every other setting made up and valid: a typo in the file fails here, not at the app's start.
  /// </summary>
  [Test]
  public void The_known_push_services_declared_in_appsettings_json_pass_validation() =>
    Failures(Settings(services: DeclaredServices())).ShouldBeEmpty();

  /// <summary>Complete, valid settings, except for the values given.</summary>
  private static PushOptions Settings(
    string? vapidPublicKey = null,
    string? vapidPrivateKey = null,
    string? messageKey = null,
    Uri? subject = null,
    IReadOnlyDictionary<string, string>? services = null,
    TimeSpan? requestTimeout = null) => new() {
      VapidPublicKey = vapidPublicKey ?? _vapidKeys.Value.PublicKey,
      VapidPrivateKey = vapidPrivateKey ?? _vapidKeys.Value.PrivateKey,
      MessageKey = messageKey ?? _messageKey.Value,
      Subject = subject ?? _subject,
      Services = services ?? _services,
      RequestTimeout = requestTimeout ?? _requestTimeout,
    };

  /// <summary>Every failure message of the start-up checks: the data annotations, then the validator.</summary>
  private static IReadOnlyList<string> Failures(PushOptions settings) {
    ValidateOptionsResult[] results = [
      new DataAnnotationValidateOptions<PushOptions>(Options.DefaultName).Validate(Options.DefaultName, settings),
      new PushOptionsValidator().Validate(Options.DefaultName, settings),
    ];

    return [.. results.Where(static result => result.Failed).SelectMany(static result => result.Failures ?? [])];
  }

  /// <summary>
  /// The <c>Push:Services</c> the app's own <c>appsettings.json</c> declares, bound into <see cref="PushOptions"/> as the
  /// app binds its section. Fails when the file declares no <c>Push</c> section.
  /// </summary>
  private static IReadOnlyDictionary<string, string> DeclaredServices() {
    IConfiguration configuration = new ConfigurationBuilder()
      .AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false)
      .Build();

    PushOptions declared = configuration.GetSection(PushOptions.SECTION).Get<PushOptions>()
      ?? throw new ShouldAssertException($"{APP_SETTINGS} declares no {PushOptions.SECTION} section.");

    return declared.Services;
  }

  /// <summary>
  /// Settings from <paramref name="settings"/> for a new key pair whose <paramref name="half"/> in standard base64 holds a
  /// character base64url does not have (<c>+</c> or <c>/</c>), as PowerShell's <c>ToBase64String</c> would write it; the
  /// other half stays in base64url, so the two are still one pair.
  /// </summary>
  private static PushOptions InStandardBase64(Func<VapidKeys, byte[]> half, Func<VapidKeys, PushOptions> settings) {
    for (int attempt = 0; attempt < 1000; attempt++) {
      VapidKeys keys = VapidKeys.New();

      if (Convert.ToBase64String(half(keys)).AsSpan().IndexOfAny('+', '/') >= 0)
        return settings(keys);
    }

    throw new UnreachableException("A thousand new keys, and none written with + or / in standard base64.");
  }

  private static string RandomBase64Url(int bytes) => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));

  /// <summary>Whether <paramref name="message"/> contains any of <paramref name="values"/>.</summary>
  private static bool QuotesAny(string message, params string[] values) =>
    values.Any(value => message.Contains(value, StringComparison.Ordinal));

  /// <summary>A new P-256 key pair, as the owner's key block makes one (D5), and the wrong forms tests build from it.</summary>
  private sealed record VapidKeys(byte[] Point, byte[] Scalar) {
    /// <summary>The public key in the settings' form: the 65-byte uncompressed point (0x04, X, Y), base64url without padding.</summary>
    public string PublicKey => Base64Url.EncodeToString(Point);

    /// <summary>The private key in the settings' form: the 32-byte scalar, base64url without padding.</summary>
    public string PrivateKey => Base64Url.EncodeToString(Scalar);

    /// <summary>The same point compressed (0x02 or 0x03 by Y's parity, then X): a P-256 point, but 33 bytes.</summary>
    public byte[] CompressedPoint => [(byte)(0x02 | (Point[^1] & 1)), .. Point.AsSpan(1, 32)];

    /// <summary>The uncompressed point with Y's last bit flipped: still 65 bytes starting with 0x04, but no longer on the curve.</summary>
    public byte[] PointOffTheCurve {
      get {
        byte[] damaged = [.. Point];
        damaged[^1] ^= 0x01;

        return damaged;
      }
    }

    public static VapidKeys New() {
      using ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
      ECParameters parameters = key.ExportParameters(includePrivateParameters: true);

      byte[] x = parameters.Q.X ?? throw new UnreachableException("An exported P-256 key has its point.");
      byte[] y = parameters.Q.Y ?? throw new UnreachableException("An exported P-256 key has its point.");
      byte[] d = parameters.D ?? throw new UnreachableException("A key exported with its private parameters has its scalar.");

      return new VapidKeys([0x04, .. x, .. y], d);
    }
  }
}