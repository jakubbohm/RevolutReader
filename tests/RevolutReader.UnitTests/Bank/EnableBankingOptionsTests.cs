using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// The Enable Banking settings are checked at start-up (c004 design.md D6, § Error model; configuration.md § Binding):
/// no secret may still hold the declared placeholder, the API address must be an absolute https address (plain http only
/// on this machine) whose path ends in "/" (a bare host's does) and that has no query or fragment, and the private key
/// must be an RSA private key in PEM form (a public key fails too). A failure names the setting, never its value. Each
/// test runs both checks the app runs at start: the settings' data annotations, as <c>ValidateDataAnnotations</c> runs
/// them, and <see cref="EnableBankingOptionsValidator"/>. Every value here is made up; every key is generated in the test.
/// </summary>
public sealed class EnableBankingOptionsTests {
  private const string PLACEHOLDER = "<secret>";
  private const string MADE_UP_APPLICATION_ID = "0c004000-0000-4000-8000-00000000a001";
  private const string MADE_UP_SESSION_ID = "0c004000-0000-4000-8000-00000000a002";
  private const string MADE_UP_ACCOUNT_ID = "0c004000-0000-4000-8000-00000000a003";

  /// <summary>Distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string PLAIN_TEXT = "plain text where the key should be, 7f3a9c";

  private static readonly Uri _apiBaseUrl = new("https://api.enablebanking.com");

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

    Failures(settings).ShouldContain(failure => failure.Contains(setting, StringComparison.Ordinal), $"a failure naming {setting}");
  }

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

    failures.ShouldContain(failure => failure.Contains(nameof(EnableBankingOptions.PrivateKey), StringComparison.Ordinal), "a failure naming PrivateKey");
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
    Failures(Settings(apiBaseUrl: new Uri(address, UriKind.RelativeOrAbsolute)))
      .ShouldContain(failure => failure.Contains(nameof(EnableBankingOptions.ApiBaseUrl), StringComparison.Ordinal), "a failure naming ApiBaseUrl");

  [Test]
  public void A_plain_http_api_address_off_this_machine_fails_validation() =>
    Failures(Settings(apiBaseUrl: new Uri("http://api.enablebanking.com")))
      .ShouldContain(failure => failure.Contains(nameof(EnableBankingOptions.ApiBaseUrl), StringComparison.Ordinal), "a failure naming ApiBaseUrl");

  [Test]
  [Arguments("https://api.enablebanking.com")]
  [Arguments("http://127.0.0.1:5000")]
  [Arguments("http://localhost:5000")]
  [Arguments("https://proxy.example/eb/")]
  public void An_https_api_address_or_an_http_one_on_this_machine_with_no_path_or_a_path_ending_in_a_slash_and_no_query_or_fragment_passes_validation(string address) =>
    Failures(Settings(apiBaseUrl: new Uri(address))).ShouldBeEmpty();

  /// <summary>Complete, valid settings, except for the values given.</summary>
  private static EnableBankingOptions Settings(Uri? apiBaseUrl = null, string? applicationId = null, string? privateKey = null, string? sessionId = null, string? accountId = null) => new() {
    ApiBaseUrl = apiBaseUrl ?? _apiBaseUrl,
    ApplicationId = applicationId ?? MADE_UP_APPLICATION_ID,
    PrivateKey = privateKey ?? _rsaKey.Value,
    SessionId = sessionId ?? MADE_UP_SESSION_ID,
    AccountId = accountId ?? MADE_UP_ACCOUNT_ID,
  };

  /// <summary>Every failure message of the start-up checks: the data annotations, then the validator.</summary>
  private static IReadOnlyList<string> Failures(EnableBankingOptions settings) {
    ValidateOptionsResult[] results = [
      new DataAnnotationValidateOptions<EnableBankingOptions>(Options.DefaultName).Validate(Options.DefaultName, settings),
      new EnableBankingOptionsValidator().Validate(Options.DefaultName, settings),
    ];

    return [.. results.Where(static result => result.Failed).SelectMany(static result => result.Failures ?? [])];
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