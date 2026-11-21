using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The sign-in settings are checked at start-up (c007 design.md D8, D11; configuration.md § Binding): every setting is
/// required, neither secret may still hold the declared placeholder, and the allowlist must hold at least one entry, no
/// empty entry, and only email addresses (text, one <c>@</c>, text). A failure names the setting by its full name, as the
/// operator sets it (#68), never the addresses or the placeholder: a failure of the settings' own rules starts with the
/// name and ": ", the validator's allowlist check opens its sentence with the name. Each test runs the checks the app runs at start, through sign-in's own registration (<see cref="SignInRegistration.AddSignIn"/>,
/// from an in-memory configuration): the settings' data annotations and <see cref="SignInOptionsValidator"/>, however those
/// checks are built. Every value here is made up.
/// </summary>
public sealed class SignInOptionsTests {
  private const string PLACEHOLDER = "<secret>";

  /// <summary>The settings' section, as the configuration names it (D8, D11), written out, so a renamed setting fails here.</summary>
  private const string SECTION = "SignIn";

  /// <summary>What each kind of failure of the settings' own rules says, besides the setting's name.</summary>
  private const string SAYS_REQUIRED = "required";
  private const string SAYS_PLACEHOLDER = "placeholder";
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
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains(SAYS_PLACEHOLDER, StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} still holds the placeholder");
    failures.ShouldAllBe(failure => !failure.Contains(PLACEHOLDER, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>
  /// A setting left out of the configuration is required: the failure names it and says so. For the allowlist, the
  /// validator's own check fails too; the required rule's failure is still there.
  /// </summary>
  /// <param name="setting">Each sign-in setting.</param>
  [Test]
  [Arguments(nameof(SignInOptions.Authority))]
  [Arguments(nameof(SignInOptions.ClientId))]
  [Arguments(nameof(SignInOptions.ClientSecret))]
  [Arguments(nameof(SignInOptions.AllowedEmails))]
  public void A_missing_sign_in_setting_fails_validation_naming_it_as_required(string setting) =>
    Failures(Settings(), leftOut: setting).ShouldContain(
      failure => failure.Contains(setting, StringComparison.Ordinal) && failure.Contains(SAYS_REQUIRED, StringComparison.OrdinalIgnoreCase),
      $"a failure saying that {setting} is required");

  [Test]
  [Arguments("")]
  [Arguments("   ")]
  [Arguments(",")]
  public void An_allowlist_without_any_address_fails_validation(string allowedEmails) =>
    ShouldNameInFull(Failures(Settings(allowedEmails: allowedEmails)), "SignIn:AllowedEmails");

  [Test]
  [Arguments($"{LUCIE},,{JANA}")]
  [Arguments($"{LUCIE}, ,{JANA}")]
  [Arguments($"{LUCIE},")] // a trailing comma leaves an empty last entry (D8: no empty entry)
  public void An_allowlist_with_an_empty_entry_between_commas_fails_validation(string allowedEmails) {
    IReadOnlyList<string> failures = Failures(Settings(allowedEmails: allowedEmails));

    ShouldNameInFull(failures, "SignIn:AllowedEmails");
    failures.ShouldAllBe(failure => !NamesAnAddress(failure, LUCIE, JANA), "no failure message may contain an address (D8)");
  }

  [Test]
  [Arguments("lucie.example.com")] // no @
  [Arguments("lucie@@example.com")] // two @
  [Arguments("@example.com")] // nothing before the @
  [Arguments("lucie@")] // nothing after the @
  public void An_allowlist_entry_that_is_not_an_email_address_fails_validation_and_the_message_does_not_contain_the_entry(string entry) {
    IReadOnlyList<string> failures = Failures(Settings(allowedEmails: $"{JANA}, {entry}"));

    ShouldNameInFull(failures, "SignIn:AllowedEmails");
    failures.ShouldAllBe(failure => !NamesAnAddress(failure, entry, JANA), "no failure message may contain the entry, or any other address (D8)");
  }

  [Test]
  [Arguments(LUCIE)]
  [Arguments($"{LUCIE}, {JANA}")]
  public void Complete_sign_in_settings_pass_validation(string allowedEmails) =>
    Failures(Settings(allowedEmails: allowedEmails)).ShouldBeEmpty();

  /// <summary>
  /// A failure of the settings' own rules (#68) names the setting by its full name, as the operator sets it
  /// (<c>SignIn:ClientSecret</c>, or <c>SignIn__ClientSecret</c> in the environment): the message starts with the section,
  /// the setting and ": ", then says what is wrong, and never holds the value.
  /// </summary>
  /// <param name="setting">Each sign-in setting, by its full name, broken by its own rule: the two public ones left out, the two secrets still holding the placeholder.</param>
  [Test]
  [Arguments("SignIn:Authority")]
  [Arguments("SignIn:ClientId")]
  [Arguments("SignIn:ClientSecret")]
  [Arguments("SignIn:AllowedEmails")]
  public void An_invalid_setting_fails_validation_with_a_message_starting_with_its_full_name_never_its_value(string setting) {
    (SignInOptions Settings, string? LeftOut, string? Value, string Says) invalid = setting switch {
      "SignIn:Authority" => (Settings(), nameof(SignInOptions.Authority), null, SAYS_REQUIRED),
      "SignIn:ClientId" => (Settings(), nameof(SignInOptions.ClientId), null, SAYS_REQUIRED),
      "SignIn:ClientSecret" => (Settings(clientSecret: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      "SignIn:AllowedEmails" => (Settings(allowedEmails: PLACEHOLDER), null, PLACEHOLDER, SAYS_PLACEHOLDER),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not a sign-in setting."),
    };

    IReadOnlyList<string> failures = Failures(invalid.Settings, invalid.LeftOut);

    failures.ShouldContain(
      failure => failure.StartsWith($"{setting}: ", StringComparison.Ordinal) && failure.Contains(invalid.Says, StringComparison.OrdinalIgnoreCase),
      $"a failure starting with \"{setting}: \" that says the setting is {invalid.Says}; the failures were: {string.Join(" | ", failures)}");

    if (invalid.Value is { } value)
      failures.ShouldAllBe(failure => !failure.Contains(value, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>Complete, valid settings, except for the values given.</summary>
  private static SignInOptions Settings(string? clientSecret = null, string? allowedEmails = null) => new() {
    Authority = _authority,
    ClientId = MADE_UP_CLIENT_ID,
    ClientSecret = clientSecret ?? MADE_UP_CLIENT_SECRET,
    AllowedEmails = allowedEmails ?? LUCIE,
  };

  /// <summary>
  /// Every failure message of the start-up checks on <paramref name="settings"/>, as the app runs them: the settings
  /// written to the configuration under their real names, all but <paramref name="leftOut"/>, then bound and checked
  /// through <see cref="SignInRegistration.AddSignIn"/>, so the data annotations and the validator. None when the settings
  /// resolve.
  /// </summary>
  /// <param name="settings">The settings to write to the configuration.</param>
  /// <param name="leftOut">A setting's name (the property's) to leave out of the configuration, or <see langword="null"/>.</param>
  private static IReadOnlyList<string> Failures(SignInOptions settings, string? leftOut = null) {
    Dictionary<string, string?> values = new(StringComparer.Ordinal) {
      [$"{SECTION}:Authority"] = settings.Authority.OriginalString,
      [$"{SECTION}:ClientId"] = settings.ClientId,
      [$"{SECTION}:ClientSecret"] = settings.ClientSecret,
      [$"{SECTION}:AllowedEmails"] = settings.AllowedEmails,
    };

    if (leftOut is not null && !values.Remove($"{SECTION}:{leftOut}"))
      throw new ArgumentOutOfRangeException(nameof(leftOut), leftOut, "Not a setting the configuration holds.");

    IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    ServiceCollection services = new();
    services.AddSingleton(configuration);
    services.AddSignIn();

    using ServiceProvider provider = services.BuildServiceProvider();

    try {
      _ = provider.GetRequiredService<IOptions<SignInOptions>>().Value;

      return [];
    }
    catch (OptionsValidationException refused) {
      return [.. refused.Failures];
    }
  }

  /// <summary>
  /// Asserts that <paramref name="failures"/> hold a failure of the validator's own check naming <paramref name="setting"/>
  /// by its full name, as the operator sets it (#68): the message opens with the name and goes straight on to say what is
  /// wrong (<c>SignIn:AllowedEmails is not …</c>), where a failure of the settings' own rules puts ": " after the name, so
  /// only the validator's failure passes, also beside the required rule's failure for an empty list. No failure may name a
  /// setting by the settings class's name instead (<c>SignInOptions.AllowedEmails</c>), which the operator cannot set.
  /// </summary>
  /// <param name="failures">The failure messages of the start-up checks.</param>
  /// <param name="setting">The setting's full name: the section, ":" and the setting.</param>
  private static void ShouldNameInFull(IReadOnlyList<string> failures, string setting) {
    failures.ShouldContain(
      failure => failure.StartsWith($"{setting} ", StringComparison.Ordinal),
      $"a failure opening with \"{setting} \"; the failures were: {string.Join(" | ", failures)}");
    failures.ShouldAllBe(
      failure => !failure.Contains($"{nameof(SignInOptions)}.", StringComparison.Ordinal),
      "no failure may name a setting by the settings class's name");
  }

  private static bool NamesAnAddress(string message, params string[] addresses) =>
    addresses.Any(address => message.Contains(address, StringComparison.OrdinalIgnoreCase));
}