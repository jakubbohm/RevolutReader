using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>
/// What the data annotations cannot check (c014 design.md D6): the check key decodes, read strictly as base64url without
/// padding (<see cref="StrictBase64Url"/>), to at least 32 bytes, and it is a key of its own, never the message key
/// (<see cref="PushOptions.MessageKey"/>), the two compared in constant time (<see cref="MessageKeyCheck.Matches"/>). Each
/// message names the settings by their full names, as the operator sets them (<c>Section:Member</c>, configuration.md
/// § Binding), never a value or any part of one. When the push settings fail their own checks, they are not compared:
/// those checks report it, once, and the app refuses to start all the same.
/// </summary>
public sealed class AccountCheckOptionsValidator(IOptions<PushOptions> push) : IValidateOptions<AccountCheckOptions> {
  private const int KEY_MIN_BYTES = 32;

  private const string NOT_A_CHECK_KEY =
    $"{AccountCheckOptions.SECTION}:{nameof(AccountCheckOptions.Key)} is not a check key: "
    + "expected at least 32 random bytes in base64url without padding.";

  private const string THE_MESSAGE_KEY =
    $"{AccountCheckOptions.SECTION}:{nameof(AccountCheckOptions.Key)} is the same key as {PushOptions.SECTION}:{nameof(PushOptions.MessageKey)}: "
    + "the check needs a key of its own, never the message key.";

  public ValidateOptionsResult Validate(string? name, AccountCheckOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    if (StrictBase64Url.Decode(options.Key) is not { Length: >= KEY_MIN_BYTES })
      return ValidateOptionsResult.Fail(NOT_A_CHECK_KEY);

    return MessageKeyOrNull() is { } messageKey && MessageKeyCheck.Matches(messageKey, options.Key)
      ? ValidateOptionsResult.Fail(THE_MESSAGE_KEY)
      : ValidateOptionsResult.Success;
  }

  /// <summary>The message key, as the push settings hold it; <see langword="null"/> when the push settings fail their own checks, which report that themselves.</summary>
  private string? MessageKeyOrNull() {
    try {
      return push.Value.MessageKey;
    }
    catch (OptionsValidationException) {
      return null;
    }
  }
}