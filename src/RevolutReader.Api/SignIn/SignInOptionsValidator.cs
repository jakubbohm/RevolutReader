using Microsoft.Extensions.Options;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// What the data annotations cannot check (D8): the allowlist parses (<see cref="Allowlist.Parse"/>), so it holds at least
/// one entry, none empty, each one email address. The message names the setting, never its value or an address.
/// </summary>
public sealed class SignInOptionsValidator : IValidateOptions<SignInOptions> {
  private const string NOT_AN_ALLOWLIST = $"{nameof(SignInOptions)}.{nameof(SignInOptions.AllowedEmails)} is not an allowlist";

  public ValidateOptionsResult Validate(string? name, SignInOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    try {
      // A missing setting is [Required]'s failure; here it reads as a list without any address.
      _ = Allowlist.Parse(options.AllowedEmails ?? string.Empty);

      return ValidateOptionsResult.Success;
    }
    catch (FormatException exception) {
      return ValidateOptionsResult.Fail($"{NOT_AN_ALLOWLIST}. {exception.Message}");
    }
  }
}