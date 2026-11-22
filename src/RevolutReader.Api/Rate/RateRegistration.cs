using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Rate;

/// <summary>The koruna rate's production wiring (c017 design.md § Public API sketch, D9).</summary>
public static class RateRegistration {
  /// <summary>
  /// <see cref="CnbOptions"/> bound and validated on start, by its data annotations and by <see cref="CnbOptionsValidator"/>
  /// (the address absolute https, or plain http on a loopback host), so an address the client could not ask stops the app
  /// at start rather than failing every request that carries a rate; the named client <see cref="CnbClient.NAME"/> with
  /// <c>BaseAddress</c> = <see cref="CnbOptions.Address"/> and <c>Timeout</c> = <see cref="CnbOptions.TimeLimit"/>, without
  /// the factory's own loggers (D7: their Information lines for every ask would log an ask that keeps nothing) and with no
  /// handler of its own, so no retries (backend conventions, c008 design.md D10); <see cref="CnbClient"/> as
  /// <see cref="ICnbRates"/> and <see cref="KorunaRates"/> as <see cref="IKorunaRates"/>, singletons (D9: the service holds
  /// the kept rate); <see cref="TimeProvider.System"/> unless one is registered. The kept rate's store is registered by
  /// <c>AddKorunaRateStore</c>. Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddKorunaRates(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<CnbOptions>()
      .BindConfiguration(CnbOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<CnbOptions>, CnbOptionsValidator>();
    services.TryAddSingleton(TimeProvider.System);

    services
      .AddHttpClient(CnbClient.NAME, static (provider, http) => {
        CnbOptions settings = provider.GetRequiredService<IOptions<CnbOptions>>().Value;

        http.BaseAddress = settings.Address;
        http.Timeout = settings.TimeLimit;
      })
      .RemoveAllLoggers();

    services.AddSingleton<ICnbRates, CnbClient>();
    services.AddSingleton<IKorunaRates, KorunaRates>();

    return services;
  }
}