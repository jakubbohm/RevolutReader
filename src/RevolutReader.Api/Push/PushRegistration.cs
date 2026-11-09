using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>Push's production wiring (c011 design.md § Public API sketch).</summary>
public static class PushRegistration {
  /// <summary>
  /// The <c>Push</c> settings, bound and validated at start (<see cref="PushOptionsValidator"/>, D5), so the app refuses to
  /// start without a valid VAPID pair, message key and app address. <see cref="KnownPushServices"/>, a singleton, so the
  /// patterns are parsed once; <see cref="RegisterDeviceHandler"/> and <see cref="SendPushHandler"/>, scoped, as the other
  /// handlers. <see cref="WebPushDelivery"/> as <see cref="IPushDelivery"/>, a typed client whose timeout is
  /// <see cref="PushOptions.RequestTimeout"/> (D13): no retry handler (D1, README.md § Backend code), and the framework's
  /// request logging and traces kept (D4). What they use is registered elsewhere: the device store by
  /// <c>AddPushDeviceStore</c>, the allowlist by <c>AddSignIn</c>. Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddPush(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<PushOptions>()
      .BindConfiguration(PushOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<PushOptions>, PushOptionsValidator>();

    services.AddSingleton<KnownPushServices>();
    services.AddScoped<RegisterDeviceHandler>();
    services.AddScoped<SendPushHandler>();

    services.AddHttpClient<IPushDelivery, WebPushDelivery>(static (provider, http) =>
      http.Timeout = provider.GetRequiredService<IOptions<PushOptions>>().Value.RequestTimeout);

    return services;
  }
}