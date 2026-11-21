using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Check;

/// <summary>The account check's production wiring (c014 design.md § Public API sketch).</summary>
public static class AccountCheckRegistration {
  /// <summary>
  /// The <c>AccountCheck</c> settings, bound and validated at start (the data annotations and
  /// <see cref="AccountCheckOptionsValidator"/>, D6), so the app refuses to start without a valid check key. Called from
  /// Program.cs.
  /// </summary>
  public static IServiceCollection AddAccountCheck(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<AccountCheckOptions>()
      .BindConfiguration(AccountCheckOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<AccountCheckOptions>, AccountCheckOptionsValidator>();

    return services;
  }
}