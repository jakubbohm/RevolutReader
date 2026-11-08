using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The SignIn section (D8, D11): Microsoft's authority, the app's registration, its client secret and the allowlist.
/// Validated on start, together with <see cref="SignInOptionsValidator"/>.
/// </summary>
public sealed class SignInOptions {
  public const string SECTION = "SignIn";

  /// <summary>Microsoft's service for personal Microsoft accounts (D3).</summary>
  [Required]
  public required Uri Authority { get; init; }

  /// <summary>The app's registration at Microsoft; not confidential (D11).</summary>
  [Required]
  public required string ClientId { get; init; }

  [Required, NotSecretPlaceholder]
  public required string ClientSecret { get; init; }

  /// <summary>The allowed accounts' email addresses, separated by commas (D8); read with <see cref="Allowlist.Parse"/>.</summary>
  [Required, NotSecretPlaceholder]
  public required string AllowedEmails { get; init; }
}