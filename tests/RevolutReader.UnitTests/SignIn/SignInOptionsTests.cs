using Microsoft.Extensions.Options;
using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The sign-in settings are checked at start-up (c007 design.md D8, D11; configuration.md § Binding): neither secret may
/// still hold the declared placeholder, and the allowlist must hold at least one entry, no empty entry, and only email
/// addresses (text, one <c>@</c>, text). A failure names the setting, never the addresses or the placeholder. Each test
/// runs both checks the app runs at start: the settings' data annotations, as <c>ValidateDataAnnotations</c> runs them, and
/// <see cref="SignInOptionsValidator"/>. Every value here is made up.
/// </summary>
public sealed class SignInOptionsTests {
  private const string PLACEHOLDER = "<secret>";
  private const string MADE_UP_CLIENT_ID = "c0070000-0000-4000-8000-00000000c001";
  private const string MADE_UP_CLIENT_SECRET = "made-up-client-secret-c007";
  private const string LUCIE = "lucie@example.com";
  private const string JANA = "jana@example.com";

  /// <summary>Microsoft's public authority for personal accounts (D3); not a secret.</summary>
  private static readonly Uri _authority = new("https://login.microsoftonline.com/consumers/v2.0");

  [Test]
  [Arguments(nameof(SignInOptions.ClientSecret))]
  [Arguments(nameof(SignInOptions.AllowedEmails))]
  public void A_sign_in_secret_still_holding_the_placeholder_fails_validation_and_the_message_names_the_setting_only(string setting) {
    SignInOptions settings = setting switch {
      nameof(SignInOptions.ClientSecret) => Settings(clientSecret: PLACEHOLDER),
      nameof(SignInOptions.AllowedEmails) => Settings(allowedEmails: PLACEHOLDER),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not one of the two secrets."),
    };

    IReadOnlyList<string> failures = Failures(settings);

    failures.ShouldContain(
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains("placeholder", StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} still holds the placeholder");
    failures.ShouldAllBe(failure => !failure.Contains(PLACEHOLDER, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  [Test]
  [Arguments("")]
  [Arguments("   ")]
  [Arguments(",")]
  public void An_allowlist_without_any_address_fails_validation(string allowedEmails) =>
    Failures(Settings(allowedEmails: allowedEmails))
      .ShouldContain(failure => failure.Contains(nameof(SignInOptions.AllowedEmails), StringComparison.Ordinal), "a failure naming AllowedEmails");

  [Test]
  [Arguments($"{LUCIE},,{JANA}")]
  [Arguments($"{LUCIE}, ,{JANA}")]
  [Arguments($"{LUCIE},")] // a trailing comma leaves an empty last entry (D8: no empty entry)
  public void An_allowlist_with_an_empty_entry_between_commas_fails_validation(string allowedEmails) {
    IReadOnlyList<string> failures = Failures(Settings(allowedEmails: allowedEmails));

    failures.ShouldContain(failure => failure.Contains(nameof(SignInOptions.AllowedEmails), StringComparison.Ordinal), "a failure naming AllowedEmails");
    failures.ShouldAllBe(failure => !NamesAnAddress(failure, LUCIE, JANA), "no failure message may contain an address (D8)");
  }

  [Test]
  [Arguments("lucie.example.com")] // no @
  [Arguments("lucie@@example.com")] // two @
  [Arguments("@example.com")] // nothing before the @
  [Arguments("lucie@")] // nothing after the @
  public void An_allowlist_entry_that_is_not_an_email_address_fails_validation_and_the_message_does_not_contain_the_entry(string entry) {
    IReadOnlyList<string> failures = Failures(Settings(allowedEmails: $"{JANA}, {entry}"));

    failures.ShouldContain(failure => failure.Contains(nameof(SignInOptions.AllowedEmails), StringComparison.Ordinal), "a failure naming AllowedEmails");
    failures.ShouldAllBe(failure => !NamesAnAddress(failure, entry, JANA), "no failure message may contain the entry, or any other address (D8)");
  }

  [Test]
  [Arguments(LUCIE)]
  [Arguments($"{LUCIE}, {JANA}")]
  public void Complete_sign_in_settings_pass_validation(string allowedEmails) =>
    Failures(Settings(allowedEmails: allowedEmails)).ShouldBeEmpty();

  /// <summary>Complete, valid settings, except for the values given.</summary>
  private static SignInOptions Settings(string? clientSecret = null, string? allowedEmails = null) => new() {
    Authority = _authority,
    ClientId = MADE_UP_CLIENT_ID,
    ClientSecret = clientSecret ?? MADE_UP_CLIENT_SECRET,
    AllowedEmails = allowedEmails ?? LUCIE,
  };

  /// <summary>Every failure message of the start-up checks: the data annotations, then the validator.</summary>
  private static IReadOnlyList<string> Failures(SignInOptions settings) {
    ValidateOptionsResult[] results = [
      new DataAnnotationValidateOptions<SignInOptions>(Options.DefaultName).Validate(Options.DefaultName, settings),
      new SignInOptionsValidator().Validate(Options.DefaultName, settings),
    ];

    return [.. results.Where(static result => result.Failed).SelectMany(static result => result.Failures ?? [])];
  }

  private static bool NamesAnAddress(string message, params string[] addresses) =>
    addresses.Any(address => message.Contains(address, StringComparison.OrdinalIgnoreCase));
}