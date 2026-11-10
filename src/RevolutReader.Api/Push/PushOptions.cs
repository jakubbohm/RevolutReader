using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Push;

/// <summary>The Push section (c011 design.md D5, D9, D13), validated on start with <see cref="PushOptionsValidator"/>.</summary>
public sealed class PushOptions {
  public const string SECTION = "Push";

  /// <summary>The VAPID public key: the 65-byte uncompressed P-256 point, base64url without padding (D5).</summary>
  [Required, NotSecretPlaceholder]
  public required string VapidPublicKey { get; init; }

  /// <summary>The VAPID private key: the 32-byte scalar, base64url without padding (D5).</summary>
  [Required, NotSecretPlaceholder]
  public required string VapidPrivateKey { get; init; }

  /// <summary>The message endpoint's key: at least 32 bytes, base64url without padding (D5, D10).</summary>
  [Required, NotSecretPlaceholder]
  public required string MessageKey { get; init; }

  /// <summary>The app's own https address: the token's contact and the base of every page a tap opens (D2, D5).</summary>
  [Required]
  public required Uri Subject { get; init; }

  /// <summary>The known push services (D9): name → origin pattern.</summary>
  [Required, MinLength(1)]
  public required IReadOnlyDictionary<string, string> Services { get; init; }

  /// <summary>How long one push request waits for its answer (D13).</summary>
  [Range(typeof(TimeSpan), "00:00:01", "00:01:00")]
  public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(10);
}