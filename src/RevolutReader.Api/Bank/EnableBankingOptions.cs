using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Bank;

/// <summary>
/// Section "EnableBanking" (c004 design.md D6): the bank's address, the four secrets, the request timeout and the first
/// wait before a retry (c008 design.md D7).
/// </summary>
public sealed class EnableBankingOptions {
  [Required]
  public required Uri ApiBaseUrl { get; init; }

  [Required, NotSecretPlaceholder]
  public required string ApplicationId { get; init; }

  /// <summary>The application's RSA private key, as PEM text.</summary>
  [Required, NotSecretPlaceholder]
  public required string PrivateKey { get; init; }

  [Required, NotSecretPlaceholder]
  public required string SessionId { get; init; }

  [Required, NotSecretPlaceholder]
  public required string AccountId { get; init; }

  /// <summary>The limit for one request with all its retries and the waits between them (c008 design.md D1).</summary>
  [Range(typeof(TimeSpan), "00:00:01", "00:02:00")]
  public TimeSpan RequestTimeout { get; init; } = TimeSpan.FromSeconds(15);

  /// <summary>The wait before the first retry; later waits double from it, spread at random (c008 design.md D4, D7). Zero in tests.</summary>
  [Range(typeof(TimeSpan), "00:00:00", "00:00:05")]
  public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(0.8);
}