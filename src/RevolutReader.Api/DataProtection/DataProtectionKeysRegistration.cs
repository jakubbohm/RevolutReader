using Azure.Identity;
using Microsoft.AspNetCore.DataProtection;

namespace RevolutReader.Api.DataProtection;

/// <summary>Where the login cookie's encryption keys live (c007 design.md D7).</summary>
public static class DataProtectionKeysRegistration {
  /// <summary>Pinned, so every revision of the app reads the same keys and a deploy signs nobody out.</summary>
  private const string APPLICATION_NAME = "RevolutReader";

  /// <summary>
  /// The app identity's client ID, under Azure.Identity's standard name, which telemetry reads too (ServiceDefaults); set
  /// by Bicep in production.
  /// </summary>
  private const string AZURE_CLIENT_ID = "AZURE_CLIENT_ID";

  private const string ONE_ADDRESS =
    $"Only one of the {DataProtectionKeysOptions.SECTION} settings {nameof(DataProtectionKeysOptions.KeysBlobUri)} and "
    + $"{nameof(DataProtectionKeysOptions.KeyVaultKeyUri)} is set: set both (production, by Bicep) or neither (locally, "
    + "ASP.NET's default key folder).";

  private const string NO_IDENTITY =
    $"The {DataProtectionKeysOptions.SECTION} settings {nameof(DataProtectionKeysOptions.KeysBlobUri)} and "
    + $"{nameof(DataProtectionKeysOptions.KeyVaultKeyUri)} are set, but {AZURE_CLIENT_ID} is not: the app reaches the keys "
    + $"blob and the Key Vault key with its managed identity, whose client ID {AZURE_CLIENT_ID} must hold.";

  private const string PARTLY_SET =
    $"The {DataProtectionKeysOptions.SECTION} settings {nameof(DataProtectionKeysOptions.KeysBlobUri)}, "
    + $"{nameof(DataProtectionKeysOptions.KeyVaultKeyUri)} and {nameof(DataProtectionKeysOptions.IdentityClientId)} are partly set: "
    + "set all three (production, by Bicep) or none (locally, ASP.NET's default key folder).";

  /// <summary>
  /// Data Protection with its application name pinned, and its keys where the configuration says (D7): the two addresses
  /// of the <c>DataProtection</c> section (<c>KeysBlobUri</c>, <c>KeyVaultKeyUri</c>, set by Bicep in production) and the
  /// app identity's client ID, <c>AZURE_CLIENT_ID</c>. An empty setting counts as not set.
  /// <list type="bullet">
  /// <item>Neither address: ASP.NET's default key store (locally, the user profile), whatever <c>AZURE_CLIENT_ID</c>
  /// holds, because telemetry alone sets it.</item>
  /// <item>Both addresses and <c>AZURE_CLIENT_ID</c>: the keys blob in Blob Storage, encrypted by the Key Vault key, both
  /// reached with that user-assigned managed identity.</item>
  /// <item>One address without the other, or both without <c>AZURE_CLIENT_ID</c>: this throws, at registration, with a
  /// message that names the settings, never their values.</item>
  /// </list>
  /// Nothing calls Azure while registering. ASP.NET's own start-up service then reads the keys once, before the server
  /// listens (on a scale-to-zero app, at every wake); a failure there is logged as an error and retried when the keys are
  /// first needed. While the app runs, they are read again about every 24 h (D7). Called from Program.cs, the composition
  /// root, because the choice is made while registering services.
  /// </summary>
  public static IServiceCollection AddDataProtectionKeys(this IServiceCollection services, IConfiguration configuration) {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(configuration);

    DataProtectionKeysOptions settings = configuration.GetSection(DataProtectionKeysOptions.SECTION).Get<DataProtectionKeysOptions>() ?? new();
    string? clientId = configuration[AZURE_CLIENT_ID];

    if ((settings.KeysBlobUri is null) != (settings.KeyVaultKeyUri is null))
      throw new InvalidOperationException(ONE_ADDRESS);

    IDataProtectionBuilder dataProtection = services.AddDataProtection().SetApplicationName(APPLICATION_NAME);

    if (settings is not { KeysBlobUri: Uri keysBlob, KeyVaultKeyUri: Uri keyVaultKey })
      return services;

    if (string.IsNullOrWhiteSpace(clientId))
      throw new InvalidOperationException(NO_IDENTITY);

    ManagedIdentityCredential appIdentity = new(ManagedIdentityId.FromUserAssignedClientId(clientId));

    dataProtection
      .PersistKeysToAzureBlobStorage(keysBlob, appIdentity)
      .ProtectKeysWithAzureKeyVault(keyVaultKey, appIdentity);

    return services;
  }

  /// <summary>
  /// Superseded by <see cref="AddDataProtectionKeys(IServiceCollection, IConfiguration)"/>, which takes the identity from
  /// <c>AZURE_CLIENT_ID</c>; goes away once nothing calls it. Here all three settings empty choose ASP.NET's default key
  /// store, all three set the keys blob encrypted by the Key Vault key, and anything in between throws, naming the
  /// settings, never their values.
  /// </summary>
  public static IServiceCollection AddDataProtectionKeys(this IServiceCollection services, DataProtectionKeysOptions options) {
    ArgumentNullException.ThrowIfNull(services);
    ArgumentNullException.ThrowIfNull(options);

    bool keysBlobSet = options.KeysBlobUri is not null;
    bool keyVaultKeySet = options.KeyVaultKeyUri is not null;
    bool identitySet = !string.IsNullOrWhiteSpace(options.IdentityClientId);
    bool allSet = keysBlobSet && keyVaultKeySet && identitySet;

    if (!allSet && (keysBlobSet || keyVaultKeySet || identitySet))
      throw new InvalidOperationException(PARTLY_SET);

    IDataProtectionBuilder dataProtection = services.AddDataProtection().SetApplicationName(APPLICATION_NAME);

    if (!allSet)
      return services;

    ManagedIdentityCredential appIdentity = new(ManagedIdentityId.FromUserAssignedClientId(options.IdentityClientId));

    dataProtection
      .PersistKeysToAzureBlobStorage(options.KeysBlobUri, appIdentity)
      .ProtectKeysWithAzureKeyVault(options.KeyVaultKeyUri, appIdentity);

    return services;
  }
}