using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>Push's production wiring (c011 design.md § Public API sketch).</summary>
public static class PushRegistration {
  /// <summary>
  /// The <c>Push</c> settings, bound and validated at start (<see cref="PushOptionsValidator"/>, D5), so the app refuses to
  /// start without a valid VAPID pair, message key and app address. Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddPush(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<PushOptions>()
      .BindConfiguration(PushOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<PushOptions>, PushOptionsValidator>();

    return services;
  }
}