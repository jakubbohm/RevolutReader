using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Bank;

namespace RevolutReader.IntegrationTests.Wiring.RealBank;

/// <summary>
/// What the checks against Enable Banking's real API share (c004 design.md D7): settings from the AppHost's user-secrets,
/// the app's own bank wiring over them, and how a read's outcome is written.
/// </summary>
public static class RealBankWiring {
  /// <summary>The AppHost's <c>UserSecretsId</c>, where the local secrets live (configuration.md § Local development and tests).</summary>
  private const string APPHOST_USER_SECRETS_ID = "683c44fb-149f-4c9d-8503-0d836e0a1639";

  private const string SECTION = "EnableBanking";

  /// <summary>The address the sandbox application and production share (appsettings.json).</summary>
  private const string API_BASE_URL = "https://api.enablebanking.com";

  /// <summary>
  /// The <c>EnableBanking</c> section from the AppHost's user-secrets: each setting from its user-secret, the shared API
  /// address, the default request timeout. A missing or blank value fails at once, before any request, naming the
  /// user-secret, never a value.
  /// </summary>
  /// <param name="secrets">Each of the section's four secrets and the user-secret that holds it.</param>
  public static Dictionary<string, string?> SettingsFromUserSecrets(IEnumerable<(string Setting, string UserSecret)> secrets) {
    ArgumentNullException.ThrowIfNull(secrets);

    IConfiguration userSecrets = new ConfigurationBuilder().AddUserSecrets(APPHOST_USER_SECRETS_ID).Build();
    Dictionary<string, string?> settings = new() { [Key("ApiBaseUrl")] = API_BASE_URL };

    foreach ((string setting, string userSecret) in secrets) {
      string? value = userSecrets[userSecret];

      if (string.IsNullOrWhiteSpace(value))
        throw new InvalidOperationException($"The AppHost's user-secrets have no {userSecret} (docs/operations/local-secrets.md sets it).");

      settings[Key(setting)] = value;
    }

    return settings;
  }

  /// <summary>The key of one of the section's settings, such as <c>EnableBanking:AccountId</c>.</summary>
  public static string Key(string setting) => $"{SECTION}:{setting}";

  /// <summary>The app's own bank wiring (<see cref="EnableBankingRegistration.AddEnableBanking"/>) over these settings.</summary>
  public static ServiceProvider Wiring(IReadOnlyDictionary<string, string?> settings) {
    ServiceCollection services = new();

    services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    services.AddEnableBanking();

    return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
  }

  /// <summary>How a read ended, from its result's value: never the value itself.</summary>
  public static string OutcomeOf(object? value) => value switch {
    Balance or Transactions or EbTransactionPage => "read",
    BankAccessExpired => "access expired",
    BankRateLimited => "rate limited",
    BankUnavailable => "bank unavailable",
    _ => "no result",
  };
}