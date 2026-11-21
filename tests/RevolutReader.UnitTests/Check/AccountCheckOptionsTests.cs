using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Check;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The check's key is checked at start-up (c014 design.md D6; configuration.md § Binding): it is required, it may not still
/// hold the declared placeholder, it is at least 32 bytes in base64url without padding, read strictly, and it is a key of
/// its own, never the message key. A failure names the setting (the section <c>AccountCheck</c> and its <c>Key</c>, and for
/// the message key <c>Push:MessageKey</c> too), never a value; a failure of the setting's own rules, and one of the
/// validator's checks, names it by its full name, as the operator sets it (#68). Each test runs the checks the app runs at
/// start, through the
/// check's own registration (<see cref="AccountCheckRegistration.AddAccountCheck"/>): the settings' data annotations and
/// <see cref="AccountCheckOptionsValidator"/>, however that validator is built. Every key here is made up, generated in the
/// test.
/// </summary>
public sealed class AccountCheckOptionsTests {
  private const string PLACEHOLDER = "<secret>";

  /// <summary>Distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string PLAIN_TEXT = "plain text where the check key should be, 9c41d2";

  /// <summary>The check key's least size (D6): 32 random bytes.</summary>
  private const int KEY_BYTES = 32;

  /// <summary>The two keys' settings, as the configuration names them (D6; c011 design.md D5).</summary>
  private const string CHECK_KEY_SETTING = "AccountCheck:Key";
  private const string MESSAGE_KEY_SETTING = "Push:MessageKey";

  /// <param name="bytes">Random bytes the key holds: the least the rule allows, and more.</param>
  [Test]
  [Arguments(32)]
  [Arguments(64)]
  public void A_check_key_of_at_least_32_bytes_in_base64url_passes_validation(int bytes) =>
    Failures(RandomBase64Url(bytes)).ShouldBeEmpty();

  [Test]
  public void A_check_key_still_holding_the_placeholder_fails_validation_and_the_message_names_the_setting_only() {
    IReadOnlyList<string> failures = Failures(PLACEHOLDER);

    failures.ShouldContain(
      failure => NamesTheSetting(failure) && failure.Contains("placeholder", StringComparison.OrdinalIgnoreCase),
      "a failure saying that AccountCheck's Key still holds the placeholder");
    failures.ShouldAllBe(failure => !failure.Contains(PLACEHOLDER, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>A check key left out of the configuration is required: the failure names it and says so; the validator's own check fails too.</summary>
  [Test]
  public void A_missing_check_key_fails_validation_naming_the_setting_as_required() =>
    Failures(key: null).ShouldContain(
      failure => NamesTheSetting(failure) && failure.Contains("required", StringComparison.OrdinalIgnoreCase),
      "a failure saying that AccountCheck's Key is required");

  /// <summary>
  /// A failure of the setting's own rules (#68) names it by its full name, as the operator sets it (<c>AccountCheck:Key</c>,
  /// or <c>AccountCheck__Key</c> in the environment): the message starts with the section, the setting and ": ", then says
  /// what is wrong, and never holds the value. The validator's own failures say <c>AccountCheck:Key is …</c>, so only the
  /// rule's failure starts this way.
  /// </summary>
  /// <param name="broken">How the key breaks its own rules: left out, or still holding the placeholder.</param>
  [Test]
  [Arguments("left out")]
  [Arguments("still the placeholder")]
  public void An_invalid_check_key_fails_validation_with_a_message_starting_with_its_full_name_never_its_value(string broken) {
    (string? Key, string Says) invalid = broken switch {
      "left out" => (null, "required"),
      "still the placeholder" => (PLACEHOLDER, "placeholder"),
      _ => throw new ArgumentOutOfRangeException(nameof(broken), broken, "Not a known case."),
    };

    IReadOnlyList<string> failures = Failures(invalid.Key);

    failures.ShouldContain(
      failure => failure.StartsWith($"{CHECK_KEY_SETTING}: ", StringComparison.Ordinal) && failure.Contains(invalid.Says, StringComparison.OrdinalIgnoreCase),
      $"a failure starting with \"{CHECK_KEY_SETTING}: \" that says the setting is {invalid.Says}; the failures were: {string.Join(" | ", failures)}");
    failures.ShouldAllBe(failure => !failure.Contains(PLACEHOLDER, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <param name="variant">A key that is shorter than 32 bytes, or not base64url without padding as an encoder writes it (D6).</param>
  [Test]
  [Arguments("31 random bytes")]
  [Arguments("16 random bytes")]
  [Arguments("plain text")]
  [Arguments("32 bytes in base64url with padding")]
  [Arguments("32 bytes in standard base64's alphabet, + or / instead of - or _")]
  [Arguments("32 bytes in base64url with a space inside")]
  public void A_check_key_shorter_than_32_bytes_or_not_strict_base64url_fails_validation_naming_the_setting_only(string variant) {
    string key = variant switch {
      "31 random bytes" => RandomBase64Url(31),
      "16 random bytes" => RandomBase64Url(16),
      "plain text" => PLAIN_TEXT,
      "32 bytes in base64url with padding" => $"{RandomBase64Url(KEY_BYTES)}=", // 32 bytes leave one "=" in a padded encoding
      "32 bytes in standard base64's alphabet, + or / instead of - or _" => InStandardAlphabet(),
      "32 bytes in base64url with a space inside" => RandomBase64Url(KEY_BYTES).Insert(20, " "),
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };

    IReadOnlyList<string> failures = Failures(key);

    ShouldNameInFull(failures, CHECK_KEY_SETTING);
    failures.ShouldAllBe(failure => !failure.Contains(key, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>
  /// The check key is a key of its own, never the message key (spec account-check, "The check answers only with its key";
  /// design.md D6; review finding 4 on PR #88): with <c>AccountCheck:Key</c> holding the same valid key as
  /// <c>Push:MessageKey</c>, the check's settings fail at start, and the failure names the two settings only, never the key
  /// or any part of it. Two different keys pass: every other test here gives the message key a key of its own.
  /// </summary>
  [Test]
  public void A_check_key_equal_to_the_message_key_fails_at_start_naming_both_settings_only() {
    string key = RandomBase64Url(KEY_BYTES);
    using ServiceProvider services = ServicesWith(checkKey: key, messageKey: key);

    OptionsValidationException refused = Should.Throw<OptionsValidationException>(() => services.GetRequiredService<IOptions<AccountCheckOptions>>().Value);

    string[] texts = [refused.Message, .. refused.Failures];
    refused.ShouldSatisfyAllConditions(
      () => ShouldNameInFull([.. refused.Failures], CHECK_KEY_SETTING, alsoNaming: MESSAGE_KEY_SETTING),
      () => texts.ShouldAllBe(text => !QuotesAnyPartOf(text, key), "no failure message may contain the key or any part of it"));
  }

  /// <summary>
  /// Every failure message of the start-up checks on <paramref name="key"/> as <c>AccountCheck:Key</c>, as the app runs them:
  /// the settings resolved through <see cref="AccountCheckRegistration.AddAccountCheck"/>, so the data annotations and the
  /// validator, with the message key a different made-up key. None when the settings resolve.
  /// </summary>
  /// <param name="key">The check key; <see langword="null"/> leaves it out of the configuration.</param>
  private static IReadOnlyList<string> Failures(string? key) {
    using ServiceProvider services = ServicesWith(checkKey: key, messageKey: RandomBase64Url(KEY_BYTES));

    try {
      _ = services.GetRequiredService<IOptions<AccountCheckOptions>>().Value;

      return [];
    }
    catch (OptionsValidationException refused) {
      return [.. refused.Failures];
    }
  }

  /// <summary>
  /// The services the app's start-up checks of the check's settings run on: the configuration's <c>AccountCheck:Key</c>
  /// <paramref name="checkKey"/> and <c>Push:MessageKey</c> <paramref name="messageKey"/>, the push settings bound from it
  /// (as the app's push registration binds them, without their own checks, which are the push settings' tests'), and the
  /// check's registration, <see cref="AccountCheckRegistration.AddAccountCheck"/>. A <see langword="null"/>
  /// <paramref name="checkKey"/> leaves it out of the configuration.
  /// </summary>
  private static ServiceProvider ServicesWith(string? checkKey, string messageKey) {
    Dictionary<string, string?> values = new(StringComparer.Ordinal) { [MESSAGE_KEY_SETTING] = messageKey };

    if (checkKey is not null)
      values[CHECK_KEY_SETTING] = checkKey;

    IConfiguration configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    ServiceCollection services = new();
    services.AddSingleton(configuration);
    services.AddOptions<PushOptions>().BindConfiguration(PushOptions.SECTION);
    services.AddAccountCheck();

    return services.BuildServiceProvider();
  }

  /// <summary>
  /// Asserts that <paramref name="failures"/> hold a failure of the validator's own checks naming <paramref name="setting"/>
  /// by its full name, as the operator sets it (#68): the message opens with the name and goes straight on to say what is
  /// wrong (<c>AccountCheck:Key is not …</c>), where a failure of the setting's own rules puts ": " after the name, so only
  /// the validator's failure passes; a second setting the same failure is about is named in full further on. No failure may
  /// name a setting by a settings class's name instead (<c>AccountCheckOptions.Key</c>, <c>PushOptions.MessageKey</c>),
  /// which the operator cannot set.
  /// </summary>
  /// <param name="failures">The failure messages of the start-up checks.</param>
  /// <param name="setting">The full name that opens the failure: the section, ":" and the setting.</param>
  /// <param name="alsoNaming">The full name of a second setting the same failure names, or <see langword="null"/>.</param>
  private static void ShouldNameInFull(IReadOnlyList<string> failures, string setting, string? alsoNaming = null) {
    failures.ShouldContain(
      failure => failure.StartsWith($"{setting} ", StringComparison.Ordinal)
        && (alsoNaming == null || failure.Contains(alsoNaming, StringComparison.Ordinal)),
      $"a failure opening with \"{setting} \"{(alsoNaming is null ? "" : $" that names \"{alsoNaming}\" too")}; the failures were: {string.Join(" | ", failures)}");
    failures.ShouldAllBe(
      failure => !failure.Contains($"{nameof(AccountCheckOptions)}.", StringComparison.Ordinal) && !failure.Contains($"{nameof(PushOptions)}.", StringComparison.Ordinal),
      "no failure may name a setting by a settings class's name");
  }

  /// <summary>Whether <paramref name="text"/> holds <paramref name="key"/> or any 8 characters of it in a row.</summary>
  private static bool QuotesAnyPartOf(string text, string key) =>
    Enumerable.Range(0, key.Length - 7).Any(start => text.Contains(key.Substring(start, 8), StringComparison.Ordinal));

  /// <summary>
  /// Whether <paramref name="failure"/> names the setting: the section, <see cref="AccountCheckOptions.SECTION"/> (alone, as
  /// in <c>AccountCheck:Key</c>, or in the settings' type name), and the setting <c>Key</c>.
  /// </summary>
  private static bool NamesTheSetting(string failure) =>
    failure.Contains(AccountCheckOptions.SECTION, StringComparison.Ordinal) && failure.Contains(nameof(AccountCheckOptions.Key), StringComparison.Ordinal);

  /// <summary>
  /// 32 random bytes in standard base64 without its padding, holding a character base64url does not have (<c>+</c> or
  /// <c>/</c>), as PowerShell's <c>ToBase64String</c> would write it; only the alphabet is wrong.
  /// </summary>
  private static string InStandardAlphabet() {
    for (int attempt = 0; attempt < 1000; attempt++) {
      string key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(KEY_BYTES)).TrimEnd('=');

      if (key.AsSpan().IndexOfAny('+', '/') >= 0)
        return key;
    }

    throw new UnreachableException("A thousand random keys, and none written with + or / in standard base64.");
  }

  private static string RandomBase64Url(int bytes) => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));
}