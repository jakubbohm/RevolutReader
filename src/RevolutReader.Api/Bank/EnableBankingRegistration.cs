using System.Security.Cryptography;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>The bank adapter's production wiring (c004 design.md § Public API sketch, D6).</summary>
public static class EnableBankingRegistration {
  /// <summary>The settings section, named after <see cref="EnableBankingOptions"/> (configuration.md § Binding).</summary>
  private const string SECTION = "EnableBanking";

  /// <summary>
  /// Options bound and validated at start; the application's key and <see cref="ApplicationToken"/> as singletons; the typed
  /// client with <c>BaseAddress</c> = <see cref="EnableBankingOptions.ApiBaseUrl"/> and <c>Timeout</c> =
  /// <see cref="EnableBankingOptions.RequestTimeout"/>; <see cref="IBankAccount"/> →
  /// <see cref="EnableBankingClient"/>; <see cref="TimeProvider.System"/> unless one is registered. Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddEnableBanking(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<EnableBankingOptions>()
      .BindConfiguration(SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<EnableBankingOptions>, EnableBankingOptionsValidator>();

    // Keyed, so no other service is handed the bank key by asking for an RSA; created by the container, so disposed by it.
    services.AddKeyedSingleton(SECTION, static (provider, _) => ApplicationKey(Settings(provider).PrivateKey));
    services.AddSingleton(static provider => new ApplicationToken(Settings(provider).ApplicationId, provider.GetRequiredKeyedService<RSA>(SECTION)));
    services.TryAddSingleton(TimeProvider.System);

    services.AddHttpClient<IBankAccount, EnableBankingClient>(static (provider, http) => {
      EnableBankingOptions settings = Settings(provider);

      http.BaseAddress = settings.ApiBaseUrl;
      http.Timeout = settings.RequestTimeout;
    });

    return services;
  }

  private static EnableBankingOptions Settings(IServiceProvider provider) => provider.GetRequiredService<IOptions<EnableBankingOptions>>().Value;

  /// <summary>The PEM loaded as <see cref="EnableBankingOptionsValidator"/> checked it at start: with <see cref="RSA.ImportFromPem"/>.</summary>
  private static RSA ApplicationKey(string privateKey) {
    RSA key = RSA.Create();

    try {
      key.ImportFromPem(privateKey);

      return key;
    }
    catch {
      key.Dispose();

      throw;
    }
  }
}