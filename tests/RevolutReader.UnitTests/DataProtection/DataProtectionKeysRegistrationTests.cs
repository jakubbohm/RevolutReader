using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.DataProtection;
using Shouldly;

namespace RevolutReader.UnitTests.DataProtection;

/// <summary>
/// Where the login cookie's encryption keys live (c007 design.md D7), chosen from the three <c>DataProtection</c> settings
/// while services are registered: all empty, ASP.NET's default key store (locally, the user profile); all set, the keys
/// blob in Blob Storage, encrypted by the Key Vault key; anything in between stops the app at registration, with a message
/// that names the settings, never their values. The choice shows in Data Protection's key management options: the key
/// repository and the key encryptor. Either way the application name is pinned (<c>RevolutReader</c>), so every revision
/// of the app reads the same keys and a deploy signs nobody out. Reading the options builds the Azure clients without
/// calling Azure: nothing here touches the network. Every address and id is made up.
/// </summary>
public sealed class DataProtectionKeysRegistrationTests {
  /// <summary>The application name Data Protection keys its keys under, pinned so every revision reads the same keys (D7).</summary>
  private const string APPLICATION_NAME = "RevolutReader";

  private const string MADE_UP_CLIENT_ID = "c0070000-0000-4000-8000-0000000000d7";

  private static readonly Uri _keysBlob = new("https://example.blob.core.windows.net/dataprotection/keys.xml");
  private static readonly Uri _keyVaultKey = new("https://example.vault.azure.net/keys/dataprotection");

  [Test]
  [Arguments("not set")]
  [Arguments("empty, as appsettings.json declares them")]
  public void All_three_key_settings_empty_choose_the_default_key_store(string settingsAre) {
    DataProtectionKeysOptions settings = settingsAre switch {
      "not set" => new(),
      // An empty address binds to none; an empty client id stays an empty text.
      "empty, as appsettings.json declares them" => new() { IdentityClientId = string.Empty },
      _ => throw new ArgumentOutOfRangeException(nameof(settingsAre), settingsAre, "Not a known case."),
    };

    (KeyManagementOptions keys, DataProtectionOptions protection) = OptionsAfterRegistering(settings);

    keys.ShouldSatisfyAllConditions(
      () => IsBlobRepository(keys.XmlRepository).ShouldBeFalse("the keys are not stored in Blob Storage"),
      () => IsKeyVaultEncryptor(keys.XmlEncryptor).ShouldBeFalse("the keys are not encrypted by a Key Vault key"),
      () => protection.ApplicationDiscriminator.ShouldBe(APPLICATION_NAME, "the application name, pinned"));
  }

  [Test]
  public void All_three_key_settings_set_choose_Blob_Storage_with_the_Key_Vault_key() {
    (KeyManagementOptions keys, DataProtectionOptions protection) = OptionsAfterRegistering(new() { KeysBlobUri = _keysBlob, KeyVaultKeyUri = _keyVaultKey, IdentityClientId = MADE_UP_CLIENT_ID });

    keys.ShouldSatisfyAllConditions(
      () => IsBlobRepository(keys.XmlRepository).ShouldBeTrue("the keys are stored in Blob Storage"),
      () => IsKeyVaultEncryptor(keys.XmlEncryptor).ShouldBeTrue("the keys are encrypted by the Key Vault key"),
      () => protection.ApplicationDiscriminator.ShouldBe(APPLICATION_NAME, "the application name, pinned"));
  }

  [Test]
  [Arguments(true, false, false)]
  [Arguments(false, true, false)]
  [Arguments(false, false, true)]
  [Arguments(true, true, false)]
  [Arguments(true, false, true)]
  [Arguments(false, true, true)]
  public void Partly_set_key_settings_are_refused_and_the_message_names_the_settings_not_their_values(bool keysBlobSet, bool keyVaultKeySet, bool identityClientIdSet) {
    DataProtectionKeysOptions settings = new() {
      KeysBlobUri = keysBlobSet ? _keysBlob : null,
      KeyVaultKeyUri = keyVaultKeySet ? _keyVaultKey : null,
      IdentityClientId = identityClientIdSet ? MADE_UP_CLIENT_ID : string.Empty,
    };

    string message = Should.Throw<Exception>(() => new ServiceCollection().AddDataProtectionKeys(settings), "refused at registration").Message;

    message.ShouldSatisfyAllConditions(
      () => message.ShouldContain(nameof(DataProtectionKeysOptions.KeysBlobUri), Case.Sensitive),
      () => message.ShouldContain(nameof(DataProtectionKeysOptions.KeyVaultKeyUri), Case.Sensitive),
      () => message.ShouldContain(nameof(DataProtectionKeysOptions.IdentityClientId), Case.Sensitive),
      () => message.ShouldNotContain(_keysBlob.Host, Case.Insensitive),
      () => message.ShouldNotContain(_keyVaultKey.Host, Case.Insensitive),
      () => message.ShouldNotContain(MADE_UP_CLIENT_ID, Case.Insensitive));
  }

  /// <summary>Data Protection's key management options and its own options, as the app would get them after registering with these settings.</summary>
  private static (KeyManagementOptions Keys, DataProtectionOptions Protection) OptionsAfterRegistering(DataProtectionKeysOptions settings) {
    ServiceCollection services = new();
    services.AddLogging();
    services.AddDataProtectionKeys(settings);

    using ServiceProvider provider = services.BuildServiceProvider();

    return (provider.GetRequiredService<IOptions<KeyManagementOptions>>().Value, provider.GetRequiredService<IOptions<DataProtectionOptions>>().Value);
  }

  /// <summary>Whether the repository is the Blob package's own (its type is internal, so it is recognised by its assembly).</summary>
  private static bool IsBlobRepository(object? repository) =>
    repository is not null && repository.GetType().Assembly == typeof(AzureStorageBlobDataProtectionBuilderExtensions).Assembly;

  /// <summary>Whether the encryptor is the Key Vault package's own (its type is internal, so it is recognised by its assembly).</summary>
  private static bool IsKeyVaultEncryptor(object? encryptor) =>
    encryptor is not null && encryptor.GetType().Assembly == typeof(AzureDataProtectionKeyVaultKeyBuilderExtensions).Assembly;
}