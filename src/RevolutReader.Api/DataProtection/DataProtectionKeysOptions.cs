namespace RevolutReader.Api.DataProtection;

/// <summary>The DataProtection section (D7): all empty (default key store) or all set (Blob + Key Vault).</summary>
public sealed class DataProtectionKeysOptions {
  public Uri? KeysBlobUri { get; init; }

  public Uri? KeyVaultKeyUri { get; init; }

  public string? IdentityClientId { get; init; }
}