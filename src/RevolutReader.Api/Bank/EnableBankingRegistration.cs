using System.Security.Cryptography;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Polly;

namespace RevolutReader.Api.Bank;

/// <summary>The bank adapter's production wiring (c004 design.md § Public API sketch, D6).</summary>
public static class EnableBankingRegistration {
  /// <summary>The settings section, named after <see cref="EnableBankingOptions"/> (configuration.md § Binding).</summary>
  private const string SECTION = "EnableBanking";

  /// <summary>The bank client's resilience pipeline, as the library's retry warnings name it (c008 design.md D9).</summary>
  private const string RETRY_PIPELINE = "bank-retries";

  /// <summary>
  /// Options bound and validated at start; the application's key and <see cref="ApplicationToken"/> as singletons; the typed
  /// client with <c>BaseAddress</c> = <see cref="EnableBankingOptions.ApiBaseUrl"/> and <c>Timeout</c> =
  /// <see cref="EnableBankingOptions.RequestTimeout"/>, without the factory's default logging (D5), and with the bank's own
  /// retry handler (<see cref="BankRetries"/>, c008 design.md D3), which that timeout wraps (D1), and inside it
  /// <see cref="WholeAnswerHandler"/>, so each attempt reads the whole answer (D6); <see cref="IBankAccount"/> →
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

    IHttpClientBuilder bank = services
      .AddHttpClient<IBankAccount, EnableBankingClient>(static (provider, http) => {
        EnableBankingOptions settings = Settings(provider);

        http.BaseAddress = settings.ApiBaseUrl;
        // Wraps the retry handler, so it limits a request with all its retries and waits (c008 design.md D1).
        http.Timeout = settings.RequestTimeout;
      })
      // The factory's own logging writes each request's URL, whose path holds the account id (D5); the client logs one
      // line per read instead.
      .RemoveAllLoggers();

    // The factory chains the handlers in the order they are added, the first outermost, so the handler added after the
    // retry handler runs inside it, within each attempt. AddResilienceHandler returns the pipeline's builder, not the
    // client's, hence two statements.
    // One retry strategy and nothing else (c008 design.md D3): the client marks which requests it may retry (D2, D8).
    bank.AddResilienceHandler(RETRY_PIPELINE, static (pipeline, context) =>
      pipeline.AddRetry(BankRetries.Options(Settings(context.ServiceProvider).RetryDelay, context.ServiceProvider.GetRequiredService<TimeProvider>())));
    // Each attempt reads the whole answer, so a break while it comes in is retried too (D6).
    bank.AddHttpMessageHandler(static () => new WholeAnswerHandler());

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