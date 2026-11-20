using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Check;

/// <summary>The key decodes (StrictBase64Url) to at least 32 bytes; the message names the setting, never a value (c014 design.md D6).</summary>
public sealed class AccountCheckOptionsValidator : IValidateOptions<AccountCheckOptions> {
  public ValidateOptionsResult Validate(string? name, AccountCheckOptions options) => throw new NotImplementedException();
}