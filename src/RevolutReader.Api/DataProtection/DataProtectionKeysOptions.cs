namespace RevolutReader.Api.DataProtection;

/// <summary>
/// The DataProtection section (c007 design.md D7): all empty (ASP.NET's default key store) or all set (the keys blob in
/// Blob Storage, encrypted by the Key Vault key). Production only, set by Bicep; read in the composition root.
/// </summary>
public sealed class DataProtectionKeysOptions {
  public const string SECTION = "DataProtection";

  /// <summary>The keys blob, e.g. <c>https://&lt;account&gt;.blob.core.windows.net/dataprotection/keys.xml</c>.</summary>
  public Uri? KeysBlobUri { get; init; }

  /// <summary>The Key Vault key that encrypts the keys, by its versionless address.</summary>
  public Uri? KeyVaultKeyUri { get; init; }

  /// <summary>The client id of the app's user-assigned managed identity, which reaches both.</summary>
  public string? IdentityClientId { get; init; }
}