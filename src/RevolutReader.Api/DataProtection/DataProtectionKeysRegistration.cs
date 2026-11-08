using Azure.Identity;
using Microsoft.AspNetCore.DataProtection;

namespace RevolutReader.Api.DataProtection;

/// <summary>Where the login cookie's encryption keys live (c007 design.md D7).</summary>
public static class DataProtectionKeysRegistration {
  /// <summary>Pinned, so every revision of the app reads the same keys and a deploy signs nobody out.</summary>
  private const string APPLICATION_NAME = "RevolutReader";

  private const string PARTLY_SET =
    $"The {DataProtectionKeysOptions.SECTION} settings {nameof(DataProtectionKeysOptions.KeysBlobUri)}, "
    + $"{nameof(DataProtectionKeysOptions.KeyVaultKeyUri)} and {nameof(DataProtectionKeysOptions.IdentityClientId)} are partly set: "
    + "set all three (production, by Bicep) or none (locally, ASP.NET's default key folder).";

  /// <summary>
  /// Data Protection with its application name pinned, and its keys where the settings say (D7): all three settings
  /// empty, ASP.NET's default key store (locally, the user profile); all three set, the keys blob in Blob Storage,
  /// encrypted by the Key Vault key, both reached with the app's user-assigned managed identity. Anything in between
  /// throws here, at registration, with a message that names the settings, never their values. Nothing calls Azure
  /// here: the clients reach it when the keys are first needed. Called from Program.cs, the composition root, because the
  /// choice is made while registering services.
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