using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Check;

/// <summary>The account check's production wiring (c014 design.md § Public API sketch).</summary>
public static class AccountCheckRegistration {
  /// <summary>
  /// The <c>AccountCheck</c> settings, bound and validated at start (the data annotations and
  /// <see cref="AccountCheckOptionsValidator"/>, D6), so the app refuses to start without a valid check key of its own,
  /// never the message key (the push settings, which <c>AddPush</c> binds).
  /// <see cref="AccountCheckQueue"/>, a singleton, as the one queue of the app copy (D10); <see cref="AccountCheck"/> as
  /// <see cref="IAccountCheck"/> and <see cref="ChangeNotifier"/>, scoped, as the handlers they use, resolved by the queue
  /// from a scope of each check's own. What they use is registered elsewhere: the store by <c>AddCheckedBalanceStore</c>,
  /// the reader by <c>AddBalance</c>, the sender by <c>AddPush</c>, the allowlist by <c>AddSignIn</c>. Called from
  /// Program.cs.
  /// </summary>
  public static IServiceCollection AddAccountCheck(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<AccountCheckOptions>()
      .BindConfiguration(AccountCheckOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<AccountCheckOptions>, AccountCheckOptionsValidator>();

    services.AddSingleton<AccountCheckQueue>();
    services.AddScoped<IAccountCheck, AccountCheck>();
    services.AddScoped<ChangeNotifier>();

    return services;
  }
}