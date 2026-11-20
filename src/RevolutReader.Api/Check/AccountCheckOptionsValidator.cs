using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>
/// What the data annotations cannot check (c014 design.md D6): the check key decodes, read strictly as base64url without
/// padding (<see cref="StrictBase64Url"/>), to at least 32 bytes. The message names the setting, never its value or any
/// part of it.
/// </summary>
public sealed class AccountCheckOptionsValidator : IValidateOptions<AccountCheckOptions> {
  private const int KEY_MIN_BYTES = 32;

  private const string NOT_A_CHECK_KEY =
    $"{AccountCheckOptions.SECTION}:{nameof(AccountCheckOptions.Key)} is not a check key: "
    + "expected at least 32 random bytes in base64url without padding.";

  public ValidateOptionsResult Validate(string? name, AccountCheckOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    return StrictBase64Url.Decode(options.Key) is { Length: >= KEY_MIN_BYTES }
      ? ValidateOptionsResult.Success
      : ValidateOptionsResult.Fail(NOT_A_CHECK_KEY);
  }
}