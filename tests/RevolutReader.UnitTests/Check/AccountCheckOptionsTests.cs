using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The check's key is checked at start-up (c014 design.md D6; configuration.md § Binding): it may not still hold the
/// declared placeholder, and it is at least 32 bytes in base64url without padding, read strictly. A failure names the
/// setting (the section <c>AccountCheck</c> and its <c>Key</c>), never its value. Each test runs both checks the app runs at
/// start, as the push settings' tests do: the settings' data annotations, as <c>ValidateDataAnnotations</c> runs them, and
/// <see cref="AccountCheckOptionsValidator"/>. Every key here is made up, generated in the test.
/// </summary>
public sealed class AccountCheckOptionsTests {
  private const string PLACEHOLDER = "<secret>";

  /// <summary>Distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string PLAIN_TEXT = "plain text where the check key should be, 9c41d2";

  /// <summary>The check key's least size (D6): 32 random bytes.</summary>
  private const int KEY_BYTES = 32;

  /// <param name="bytes">Random bytes the key holds: the least the rule allows, and more.</param>
  [Test]
  [Arguments(32)]
  [Arguments(64)]
  public void A_check_key_of_at_least_32_bytes_in_base64url_passes_validation(int bytes) =>
    Failures(Settings(RandomBase64Url(bytes))).ShouldBeEmpty();

  [Test]
  public void A_check_key_still_holding_the_placeholder_fails_validation_and_the_message_names_the_setting_only() {
    IReadOnlyList<string> failures = Failures(Settings(PLACEHOLDER));

    failures.ShouldContain(
      failure => NamesTheSetting(failure) && failure.Contains("placeholder", StringComparison.OrdinalIgnoreCase),
      "a failure saying that AccountCheck's Key still holds the placeholder");
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

    IReadOnlyList<string> failures = Failures(Settings(key));

    failures.ShouldContain(failure => NamesTheSetting(failure), "a failure naming AccountCheck's Key");
    failures.ShouldAllBe(failure => !failure.Contains(key, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  private static AccountCheckOptions Settings(string key) => new() { Key = key };

  /// <summary>Every failure message of the start-up checks: the data annotations, then the validator.</summary>
  private static IReadOnlyList<string> Failures(AccountCheckOptions settings) {
    ValidateOptionsResult[] results = [
      new DataAnnotationValidateOptions<AccountCheckOptions>(Options.DefaultName).Validate(Options.DefaultName, settings),
      new AccountCheckOptionsValidator().Validate(Options.DefaultName, settings),
    ];

    return [.. results.Where(static result => result.Failed).SelectMany(static result => result.Failures ?? [])];
  }

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