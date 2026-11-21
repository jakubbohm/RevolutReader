using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// The Enable Banking settings are checked at start-up (c004 design.md D6, § Error model; configuration.md § Binding):
/// every setting but the two times is required, no secret may still hold the declared placeholder, the API address must
/// be an absolute https address (plain http only on this machine) whose path ends in "/" (a bare host's does) and that
/// has no query or fragment, the private key must be an RSA private key in PEM form (a public key fails too), and the
/// request timeout lies between 1 second and 2 minutes. A failure names the setting by its full name, as the operator sets
/// it (#68), never its value: a failure of the settings' own rules starts with the name and ": ", one of the validator's
/// checks opens its sentence with the name. Each test runs the checks the app runs at start, through the bank adapter's own
/// registration (<see cref="EnableBankingRegistration.AddEnableBanking"/>, from an
/// in-memory configuration): the settings' data annotations and <see cref="EnableBankingOptionsValidator"/>, however those
/// checks are built. Every value here is made up; every key is generated in the test.
/// </summary>
public sealed class EnableBankingOptionsTests {
  private const string PLACEHOLDER = "<secret>";
  private const string MADE_UP_APPLICATION_ID = "0c004000-0000-4000-8000-00000000a001";
  private const string MADE_UP_SESSION_ID = "0c004000-0000-4000-8000-00000000a002";
  private const string MADE_UP_ACCOUNT_ID = "0c004000-0000-4000-8000-00000000a003";

  /// <summary>The settings' section, as the configuration names it (D6), written out, so a renamed setting fails here.</summary>
  private const string SECTION = "EnableBanking";

  /// <summary>Distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string PLAIN_TEXT = "plain text where the key should be, 7f3a9c";

  /// <summary>What each kind of failure of the settings' own rules says, besides the setting's name.</summary>
  private const string SAYS_REQUIRED = "required";
  private const string SAYS_PLACEHOLDER = "placeholder";
  private const string SAYS_OUT_OF_RANGE = "between";

  private static readonly Uri _apiBaseUrl = new("https://api.enablebanking.com");

  /// <summary>The defaults <c>EnableBankingOptions</c> declares (c008 design.md D1, D7).</summary>
  private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(15);
  private static readonly TimeSpan _retryDelay = TimeSpan.FromSeconds(0.8);

  private static readonly Lazy<string> _rsaKey = new(static () => RsaKeyPem("PRIVATE KEY"));

  [Test]
  [Arguments(nameof(EnableBankingOptions.ApplicationId))]
  [Arguments(nameof(EnableBankingOptions.PrivateKey))]
  [Arguments(nameof(EnableBankingOptions.SessionId))]
  [Arguments(nameof(EnableBankingOptions.AccountId))]
  public void A_setting_still_holding_the_secret_placeholder_fails_validation(string setting) {
    EnableBankingOptions settings = setting switch {
      nameof(EnableBankingOptions.ApplicationId) => Settings(applicationId: PLACEHOLDER),
      nameof(EnableBankingOptions.PrivateKey) => Settings(privateKey: PLACEHOLDER),
      nameof(EnableBankingOptions.SessionId) => Settings(sessionId: PLACEHOLDER),
      nameof(EnableBankingOptions.AccountId) => Settings(accountId: PLACEHOLDER),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not one of the four secrets."),
    };

    IReadOnlyList<string> failures = Failures(settings);

    // The placeholder rule's own failure: for the private key, the key check fails too and names the setting as well.
    failures.ShouldContain(
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains(SAYS_PLACEHOLDER, StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} still holds the placeholder");
    failures.ShouldAllBe(failure => !failure.Contains(PLACEHOLDER, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>
  /// A setting left out of the configuration is required: the failure names it and says so. For the address and the key,
  /// the validator's own check fails too; the required rule's failure is still there.
  /// </summary>
  /// <param name="setting">Each setting with no default.</param>
  [Test]
  [Arguments(nameof(EnableBankingOptions.ApiBaseUrl))]
  [Arguments(nameof(EnableBankingOptions.ApplicationId))]
  [Arguments(nameof(EnableBankingOptions.PrivateKey))]
  [Arguments(nameof(EnableBankingOptions.SessionId))]
  [Arguments(nameof(EnableBankingOptions.AccountId))]
  public void A_missing_setting_fails_validation_naming_it_as_required(string setting) =>
    Failures(Settings(), leftOut: setting).ShouldContain(
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains(SAYS_REQUIRED, StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} is required");

  [Test]
  [Arguments("plain text")]
  [Arguments("an EC key in PEM form")]
  [Arguments("an RSA public key in PEM form")]
  public void A_private_key_that_is_not_an_RSA_private_key_in_PEM_form_fails_validation_and_the_message_does_not_contain_the_key(string notAnRsaPrivateKey) {
    string privateKey = notAnRsaPrivateKey switch {
      "plain text" => PLAIN_TEXT,
      "an EC key in PEM form" => EcKeyPem(),
      "an RSA public key in PEM form" => RsaPublicKeyPem(),
      _ => throw new ArgumentOutOfRangeException(nameof(notAnRsaPrivateKey), notAnRsaPrivateKey, "Not a known case."),
    };

    IReadOnlyList<string> failures = Failures(Settings(privateKey: privateKey));

    ShouldNameInFull(failures, "EnableBanking:PrivateKey");
    failures.ShouldAllBe(failure => !Contains(failure, privateKey), "no failure message may contain the key or any line of it");
  }

  [Test]
  [Arguments("PRIVATE KEY")]
  [Arguments("RSA PRIVATE KEY")]
  public void Complete_settings_pass_validation(string pemLabel) =>
    Failures(Settings(privateKey: RsaKeyPem(pemLabel))).ShouldBeEmpty();

  [Test]
  [Arguments("https://proxy.example/eb")] // its last path segment would be dropped
  [Arguments("api.enablebanking.com")] // no scheme: binds as a relative address
  [Arguments("ftp://api.enablebanking.com")] // not HTTP
  [Arguments("https://proxy.example/eb/?tenant=x")] // its query would be dropped
  [Arguments("https://api.enablebanking.com/#x")] // its fragment would be dropped
  public void An_api_address_requests_cannot_be_resolved_against_fails_validation(string address) =>
    ShouldNameInFull(Failures(Settings(apiBaseUrl: new Uri(address, UriKind.RelativeOrAbsolute))), "EnableBanking:ApiBaseUrl");

  [Test]
  public void A_plain_http_api_address_off_this_machine_fails_validation() =>
    ShouldNameInFull(Failures(Settings(apiBaseUrl: new Uri("http://api.enablebanking.com"))), "EnableBanking:ApiBaseUrl");

  [Test]
  [Arguments("https://api.enablebanking.com")]
  [Arguments("http://127.0.0.1:5000")]
  [Arguments("http://localhost:5000")]
  [Arguments("https://proxy.example/eb/")]
  public void An_https_api_address_or_an_http_one_on_this_machine_with_no_path_or_a_path_ending_in_a_slash_and_no_query_or_fragment_passes_validation(string address) =>
    Failures(Settings(apiBaseUrl: new Uri(address))).ShouldBeEmpty();

  /// <param name="requestTimeout">Shorter than 1 second or longer than 2 minutes (c008 design.md D1), as a TimeSpan setting reads.</param>
  [Test]
  [Arguments("00:00:00")]
  [Arguments("00:00:00.999")]
  [Arguments("00:02:00.001")]
  [Arguments("00:05:00")]
  public void A_request_timeout_outside_1_second_to_2_minutes_fails_validation(string requestTimeout) =>
    Failures(Settings(requestTimeout: TimeSpan.Parse(requestTimeout, CultureInfo.InvariantCulture)))
      .ShouldContain(failure => failure.Contains(nameof(EnableBankingOptions.RequestTimeout), StringComparison.Ordinal), "a failure naming RequestTimeout");

  /// <param name="requestTimeout">The shortest and the longest request timeout the rule allows.</param>
  [Test]
  [Arguments("00:00:01")]
  [Arguments("00:02:00")]
  public void A_request_timeout_of_1_second_to_2_minutes_passes_validation(string requestTimeout) =>
    Failures(Settings(requestTimeout: TimeSpan.Parse(requestTimeout, CultureInfo.InvariantCulture))).ShouldBeEmpty();

  /// <summary>
  /// A failure of the settings' own rules (#68) names the setting by its full name, as the operator sets it
  /// (<c>EnableBanking:AccountId</c>, or <c>EnableBanking__AccountId</c> in the environment): the message starts with the
  /// section, the setting and ": ", then says what is wrong, and never holds the value.
  /// </summary>
  /// <param name="setting">Each setting with a rule of its own, by its full name, broken by that rule: the address left out, a secret still holding the placeholder, a time outside its range.</param>
  [Test]
  [Arguments("EnableBanking:ApiBaseUrl")]
  [Arguments("EnableBanking:ApplicationId")]
  [Arguments("EnableBanking:PrivateKey")]
  [Arguments("EnableBanking:SessionId")]
  [Arguments("EnableBanking:AccountId")]
  [Arguments("EnableBanking:RequestTimeout")]
  [Arguments("EnableBanking:RetryDelay")]
  public void An_invalid_setting_fails_validation_with_a_message_starting_with_its_full_name_never_its_value(string setting) {
    (EnableBankingOptions Settings, string? LeftOut, string? Value, string Says) invalid = setting switch {
      "EnableBanking:ApiBaseUrl" => (Settings(), nameof(EnableBankingOptions.ApiBaseUrl), null, SAYS_REQUIRED),
      "EnableBanking:ApplicationId" => (Settings(applicationId: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      "EnableBanking:PrivateKey" => (Settings(privateKey: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      "EnableBanking:SessionId" => (Settings(sessionId: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      "EnableBanking:AccountId" => (Settings(accountId: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      "EnableBanking:RequestTimeout" => (Settings(requestTimeout: TimeSpan.FromMinutes(5)), null, "00:05:00", SAYS_OUT_OF_RANGE),
      "EnableBanking:RetryDelay" => (Settings(retryDelay: TimeSpan.FromSeconds(6)), null, "00:00:06", SAYS_OUT_OF_RANGE),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not a setting with a rule of its own."),
    };

    IReadOnlyList<string> failures = Failures(invalid.Settings, invalid.LeftOut);

    failures.ShouldContain(
      failure => failure.StartsWith($"{setting}: ", StringComparison.Ordinal) && failure.Contains(invalid.Says, StringComparison.OrdinalIgnoreCase),
      $"a failure starting with \"{setting}: \" that says the setting is {invalid.Says}; the failures were: {string.Join(" | ", failures)}");

    if (invalid.Value is { } value)
      failures.ShouldAllBe(failure => !failure.Contains(value, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>Complete, valid settings, except for the values given.</summary>
  private static EnableBankingOptions Settings(
    Uri? apiBaseUrl = null,
    string? applicationId = null,
    string? privateKey = null,
    string? sessionId = null,
    string? accountId = null,
    TimeSpan? requestTimeout = null,
    TimeSpan? retryDelay = null) => new() {
      ApiBaseUrl = apiBaseUrl ?? _apiBaseUrl,
      ApplicationId = applicationId ?? MADE_UP_APPLICATION_ID,
      PrivateKey = privateKey ?? _rsaKey.Value,
      SessionId = sessionId ?? MADE_UP_SESSION_ID,
      AccountId = accountId ?? MADE_UP_ACCOUNT_ID,
      RequestTimeout = requestTimeout ?? _requestTimeout,
      RetryDelay = retryDelay ?? _retryDelay,
    };

  /// <summary>
  /// Every failure message of the start-up checks on <paramref name="settings"/>, as the app runs them: the settings
  /// written to the configuration under their real names, all but <paramref name="leftOut"/>, then bound and checked
  /// through <see cref="EnableBankingRegistration.AddEnableBanking"/>, so the data annotations and the validator. None
  /// when the settings resolve.
  /// </summary>
  /// <param name="settings">The settings to write to the configuration.</param>
  /// <param name="leftOut">A setting's name (the property's) to leave out of the configuration, or <see langword="null"/>.</param>
  private static IReadOnlyList<string> Failures(EnableBankingOptions settings, string? leftOut = null) {
    Dictionary<string, string?> values = new(StringComparer.Ordinal) {
      [$"{SECTION}:ApiBaseUrl"] = settings.ApiBaseUrl.OriginalString,
      [$"{SECTION}:ApplicationId"] = settings.ApplicationId,
      [$"{SECTION}:PrivateKey"] = settings.PrivateKey,
      [$"{SECTION}:SessionId"] = settings.SessionId,
      [$"{SECTION}:AccountId"] = settings.AccountId,
      [$"{SECTION}:RequestTimeout"] = settings.RequestTimeout.ToString("c", CultureInfo.InvariantCulture),
      [$"{SECTION}:RetryDelay"] = settings.RetryDelay.ToString("c", CultureInfo.InvariantCulture),
    };

    if (leftOut is not null && !values.Remove($"{SECTION}:{leftOut}"))
      throw new ArgumentOutOfRangeException(nameof(leftOut), leftOut, "Not a setting the configuration holds.");

    IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    ServiceCollection services = new();
    services.AddSingleton(configuration);
    services.AddEnableBanking();

    using ServiceProvider provider = services.BuildServiceProvider();

    try {
      _ = provider.GetRequiredService<IOptions<EnableBankingOptions>>().Value;

      return [];
    }
    catch (OptionsValidationException refused) {
      return [.. refused.Failures];
    }
  }

  /// <summary>
  /// Asserts that <paramref name="failures"/> hold a failure of the validator's own checks naming <paramref name="setting"/>
  /// by its full name, as the operator sets it (#68): the message opens with the name and goes straight on to say what is
  /// wrong (<c>EnableBanking:PrivateKey is not …</c>), where a failure of the settings' own rules puts ": " after the name,
  /// so only the validator's failure passes. No failure may name a setting by the settings class's name instead
  /// (<c>EnableBankingOptions.PrivateKey</c>), which the operator cannot set.
  /// </summary>
  /// <param name="failures">The failure messages of the start-up checks.</param>
  /// <param name="setting">The setting's full name: the section, ":" and the setting.</param>
  private static void ShouldNameInFull(IReadOnlyList<string> failures, string setting) {
    failures.ShouldContain(
      failure => failure.StartsWith($"{setting} ", StringComparison.Ordinal),
      $"a failure opening with \"{setting} \"; the failures were: {string.Join(" | ", failures)}");
    failures.ShouldAllBe(
      failure => !failure.Contains($"{nameof(EnableBankingOptions)}.", StringComparison.Ordinal),
      "no failure may name a setting by the settings class's name");
  }

  /// <summary>Whether <paramref name="message"/> contains <paramref name="value"/>, or any of its lines longer than a word.</summary>
  private static bool Contains(string message, string value) =>
    message.Contains(value, StringComparison.Ordinal)
    || value.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
      .Where(static line => line.Length > 16)
      .Any(line => message.Contains(line, StringComparison.Ordinal));

  /// <summary>A new 2048-bit RSA private key, as PKCS#8 (<c>PRIVATE KEY</c>) or PKCS#1 (<c>RSA PRIVATE KEY</c>) PEM.</summary>
  private static string RsaKeyPem(string pemLabel) {
    using RSA key = RSA.Create(2048);

    return pemLabel switch {
      "PRIVATE KEY" => key.ExportPkcs8PrivateKeyPem(),
      "RSA PRIVATE KEY" => key.ExportRSAPrivateKeyPem(),
      _ => throw new ArgumentOutOfRangeException(nameof(pemLabel), pemLabel, "Not an RSA private key PEM label."),
    };
  }

  /// <summary>A new RSA key's public half, as PEM (<c>PUBLIC KEY</c>): an RSA key, but nothing to sign with.</summary>
  private static string RsaPublicKeyPem() {
    using RSA key = RSA.Create(2048);

    return key.ExportSubjectPublicKeyInfoPem();
  }

  /// <summary>A new P-256 private key, as PKCS#8 PEM: the same label as an RSA key's, another algorithm inside.</summary>
  private static string EcKeyPem() {
    using ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    return key.ExportPkcs8PrivateKeyPem();
  }
}