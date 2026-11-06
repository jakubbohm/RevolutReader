using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>The key parses as an RSA key in PEM form (c004 design.md D6). The message names the setting, never its value.</summary>
public sealed class EnableBankingOptionsValidator : IValidateOptions<EnableBankingOptions> {
  public ValidateOptionsResult Validate(string? name, EnableBankingOptions options) => throw new NotImplementedException();
}