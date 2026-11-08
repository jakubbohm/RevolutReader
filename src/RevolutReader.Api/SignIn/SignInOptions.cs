namespace RevolutReader.Api.SignIn;

/// <summary>The SignIn section (D8, D11). Validated on start.</summary>
public sealed class SignInOptions {
  public const string SECTION = "SignIn";

  public required Uri Authority { get; init; }

  public required string ClientId { get; init; }

  public required string ClientSecret { get; init; }

  public required string AllowedEmails { get; init; }
}