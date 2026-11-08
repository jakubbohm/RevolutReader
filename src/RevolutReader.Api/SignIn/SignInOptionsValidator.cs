using Microsoft.Extensions.Options;

namespace RevolutReader.Api.SignIn;

/// <summary>The allowlist parses: at least one entry, none empty, each one address. Messages name the setting only.</summary>
public sealed class SignInOptionsValidator : IValidateOptions<SignInOptions> {
  public ValidateOptionsResult Validate(string? name, SignInOptions options) => throw new NotImplementedException();
}