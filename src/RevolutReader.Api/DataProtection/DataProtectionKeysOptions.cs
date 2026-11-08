namespace RevolutReader.Api.DataProtection;

/// <summary>
/// The DataProtection section (c007 design.md D7): its two addresses both empty (ASP.NET's default key store) or both set
/// (the keys blob in Blob Storage, encrypted by the Key Vault key, reached with the app identity whose client ID
/// <c>AZURE_CLIENT_ID</c> holds). Production only, set by Bicep; bound by <see cref="DataProtectionKeysRegistration"/>
/// from the configuration the composition root hands it.
/// </summary>
public sealed class DataProtectionKeysOptions {
  public const string SECTION = "DataProtection";

  /// <summary>The keys blob, e.g. <c>https://&lt;account&gt;.blob.core.windows.net/dataprotection/keys.xml</c>.</summary>
  public Uri? KeysBlobUri { get; init; }

  /// <summary>The Key Vault key that encrypts the keys, by its versionless address.</summary>
  public Uri? KeyVaultKeyUri { get; init; }
}