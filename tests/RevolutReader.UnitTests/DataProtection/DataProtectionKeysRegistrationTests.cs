using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.DataProtection;
using Shouldly;

namespace RevolutReader.UnitTests.DataProtection;

/// <summary>
/// Where the login cookie's encryption keys live (c007 design.md D7), chosen while services are registered from the
/// app's configuration: the two addresses in the <c>DataProtection</c> section (<c>DataProtection:KeysBlobUri</c>,
/// <c>DataProtection:KeyVaultKeyUri</c>, set by Bicep in production) and the app identity's client id,
/// <c>AZURE_CLIENT_ID</c>, Azure.Identity's standard setting, which telemetry reads too:
/// <list type="bullet">
/// <item>neither address set: ASP.NET's default key store (locally, the user profile), whether or not
/// <c>AZURE_CLIENT_ID</c> is set, because telemetry alone sets it;</item>
/// <item>both addresses and <c>AZURE_CLIENT_ID</c> set: the keys blob in Blob Storage, encrypted by the Key Vault key,
/// both reached with that identity;</item>
/// <item>exactly one address set: refused at registration, the message naming both addresses;</item>
/// <item>both addresses without <c>AZURE_CLIENT_ID</c> (empty or missing): refused at registration, the message naming
/// <c>AZURE_CLIENT_ID</c> and the section.</item>
/// </list>
/// A message names settings, never their values. An empty setting, as <c>appsettings.json</c> declares each of them,
/// counts as not set. The tests use the settings' real names, so they pin the names too.
/// <para>
/// The choice shows in Data Protection's key management options: the key repository and the key encryptor. Either way
/// the application name is pinned (<c>RevolutReader</c>), so every revision of the app reads the same keys and a deploy
/// signs nobody out. Reading the options builds the Azure clients without calling Azure: nothing here touches the
/// network. Every address and id is made up.
/// </para>
/// </summary>
public sealed class DataProtectionKeysRegistrationTests {
  /// <summary>The application name Data Protection keys its keys under, pinned so every revision reads the same keys (D7).</summary>
  private const string APPLICATION_NAME = "RevolutReader";

  private const string MADE_UP_CLIENT_ID = "c0070000-0000-4000-8000-0000000000d7";

  /// <summary>
  /// The settings' real names, written out, so a renamed setting fails here: the section and its two addresses, set by
  /// Bicep in production, and the app identity's client id under Azure.Identity's standard name.
  /// </summary>
  private const string SECTION = "DataProtection";
  private const string KEYS_BLOB_URI_NAME = "KeysBlobUri";
  private const string KEY_VAULT_KEY_URI_NAME = "KeyVaultKeyUri";
  private const string AZURE_CLIENT_ID = "AZURE_CLIENT_ID";

  private static readonly Uri _keysBlob = new("https://example.blob.core.windows.net/dataprotection/keys.xml");
  private static readonly Uri _keyVaultKey = new("https://example.vault.azure.net/keys/dataprotection");

  [Test]
  [Arguments("nothing set")]
  [Arguments("all empty, as appsettings.json declares them")]
  [Arguments("only AZURE_CLIENT_ID set, as telemetry sets it")]
  public void Neither_key_address_set_chooses_the_default_key_store_whatever_AZURE_CLIENT_ID_holds(string settingsAre) {
    IConfiguration configuration = settingsAre switch {
      "nothing set" => Configuration(keysBlobUri: null, keyVaultKeyUri: null, azureClientId: null),
      "all empty, as appsettings.json declares them" => Configuration(keysBlobUri: string.Empty, keyVaultKeyUri: string.Empty, azureClientId: string.Empty),
      "only AZURE_CLIENT_ID set, as telemetry sets it" => Configuration(keysBlobUri: string.Empty, keyVaultKeyUri: string.Empty, azureClientId: MADE_UP_CLIENT_ID),
      _ => throw new ArgumentOutOfRangeException(nameof(settingsAre), settingsAre, "Not a known case."),
    };

    (KeyManagementOptions keys, DataProtectionOptions protection) = OptionsAfterRegistering(configuration);

    keys.ShouldSatisfyAllConditions(
      () => IsBlobRepository(keys.XmlRepository).ShouldBeFalse("the keys are not stored in Blob Storage"),
      () => IsKeyVaultEncryptor(keys.XmlEncryptor).ShouldBeFalse("the keys are not encrypted by a Key Vault key"),
      () => protection.ApplicationDiscriminator.ShouldBe(APPLICATION_NAME, "the application name, pinned"));
  }

  [Test]
  public void Both_key_addresses_and_AZURE_CLIENT_ID_set_choose_Blob_Storage_with_the_Key_Vault_key() {
    (KeyManagementOptions keys, DataProtectionOptions protection) =
      OptionsAfterRegistering(Configuration(keysBlobUri: _keysBlob.AbsoluteUri, keyVaultKeyUri: _keyVaultKey.AbsoluteUri, azureClientId: MADE_UP_CLIENT_ID));

    keys.ShouldSatisfyAllConditions(
      () => IsBlobRepository(keys.XmlRepository).ShouldBeTrue("the keys are stored in Blob Storage"),
      () => IsKeyVaultEncryptor(keys.XmlEncryptor).ShouldBeTrue("the keys are encrypted by the Key Vault key"),
      () => protection.ApplicationDiscriminator.ShouldBe(APPLICATION_NAME, "the application name, pinned"));
  }

  [Test]
  [Arguments("only KeysBlobUri, with AZURE_CLIENT_ID")]
  [Arguments("only KeyVaultKeyUri, with AZURE_CLIENT_ID")]
  [Arguments("only KeysBlobUri, AZURE_CLIENT_ID empty")]
  [Arguments("only KeyVaultKeyUri, AZURE_CLIENT_ID missing")]
  public void Exactly_one_key_address_set_is_refused_and_the_message_names_both_addresses_not_their_values(string settingsAre) {
    IConfiguration configuration = settingsAre switch {
      "only KeysBlobUri, with AZURE_CLIENT_ID" => Configuration(keysBlobUri: _keysBlob.AbsoluteUri, keyVaultKeyUri: string.Empty, azureClientId: MADE_UP_CLIENT_ID),
      "only KeyVaultKeyUri, with AZURE_CLIENT_ID" => Configuration(keysBlobUri: null, keyVaultKeyUri: _keyVaultKey.AbsoluteUri, azureClientId: MADE_UP_CLIENT_ID),
      "only KeysBlobUri, AZURE_CLIENT_ID empty" => Configuration(keysBlobUri: _keysBlob.AbsoluteUri, keyVaultKeyUri: null, azureClientId: string.Empty),
      "only KeyVaultKeyUri, AZURE_CLIENT_ID missing" => Configuration(keysBlobUri: string.Empty, keyVaultKeyUri: _keyVaultKey.AbsoluteUri, azureClientId: null),
      _ => throw new ArgumentOutOfRangeException(nameof(settingsAre), settingsAre, "Not a known case."),
    };

    string message = Should.Throw<Exception>(() => new ServiceCollection().AddDataProtectionKeys(configuration), "refused at registration").Message;

    message.ShouldSatisfyAllConditions(
      () => message.ShouldContain(KEYS_BLOB_URI_NAME, Case.Sensitive),
      () => message.ShouldContain(KEY_VAULT_KEY_URI_NAME, Case.Sensitive),
      () => message.ShouldNotContain(_keysBlob.Host, Case.Insensitive),
      () => message.ShouldNotContain(_keyVaultKey.Host, Case.Insensitive),
      () => message.ShouldNotContain(MADE_UP_CLIENT_ID, Case.Insensitive));
  }

  [Test]
  [Arguments("empty, as appsettings.json declares it")]
  [Arguments("missing")]
  public void Both_key_addresses_set_without_AZURE_CLIENT_ID_are_refused_and_the_message_names_it_not_the_values(string azureClientIdIs) {
    IConfiguration configuration = azureClientIdIs switch {
      "empty, as appsettings.json declares it" => Configuration(keysBlobUri: _keysBlob.AbsoluteUri, keyVaultKeyUri: _keyVaultKey.AbsoluteUri, azureClientId: string.Empty),
      "missing" => Configuration(keysBlobUri: _keysBlob.AbsoluteUri, keyVaultKeyUri: _keyVaultKey.AbsoluteUri, azureClientId: null),
      _ => throw new ArgumentOutOfRangeException(nameof(azureClientIdIs), azureClientIdIs, "Not a known case."),
    };

    string message = Should.Throw<Exception>(() => new ServiceCollection().AddDataProtectionKeys(configuration), "refused at registration").Message;

    message.ShouldSatisfyAllConditions(
      () => message.ShouldContain(AZURE_CLIENT_ID, Case.Sensitive),
      () => message.ShouldContain(SECTION, Case.Sensitive),
      () => message.ShouldNotContain(_keysBlob.Host, Case.Insensitive),
      () => message.ShouldNotContain(_keyVaultKey.Host, Case.Insensitive));
  }

  /// <summary>
  /// The app's configuration with these settings under their real names: <see langword="null"/> leaves a setting out,
  /// an empty text declares it empty, as <c>appsettings.json</c> does.
  /// </summary>
  private static IConfiguration Configuration(string? keysBlobUri, string? keyVaultKeyUri, string? azureClientId) {
    Dictionary<string, string?> settings = [];

    if (keysBlobUri is not null)
      settings[$"{SECTION}:{KEYS_BLOB_URI_NAME}"] = keysBlobUri;

    if (keyVaultKeyUri is not null)
      settings[$"{SECTION}:{KEY_VAULT_KEY_URI_NAME}"] = keyVaultKeyUri;

    if (azureClientId is not null)
      settings[AZURE_CLIENT_ID] = azureClientId;

    return new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
  }

  /// <summary>Data Protection's key management options and its own options, as the app would get them after registering with this configuration.</summary>
  private static (KeyManagementOptions Keys, DataProtectionOptions Protection) OptionsAfterRegistering(IConfiguration configuration) {
    ServiceCollection services = new();
    services.AddLogging();
    services.AddDataProtectionKeys(configuration);

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