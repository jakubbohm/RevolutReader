using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Check;

/// <summary>The AccountCheck section (c014 design.md D6), validated on start with <see cref="AccountCheckOptionsValidator"/>.</summary>
public sealed class AccountCheckOptions {
  public const string SECTION = "AccountCheck";

  /// <summary>The check endpoint's key: at least 32 random bytes, base64url without padding, a key of its own, never the message key (D6).</summary>
  [Required, NotSecretPlaceholder]
  public required string Key { get; init; }
}