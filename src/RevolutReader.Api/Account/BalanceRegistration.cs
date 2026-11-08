namespace RevolutReader.Api.Account;

/// <summary>The balance's production wiring (c009 design.md § Public API sketch).</summary>
public static class BalanceRegistration {
  /// <summary>
  /// <see cref="ReadBalanceHandler"/>, scoped, for <see cref="BalanceEndpoint"/>. What it reads with is registered elsewhere:
  /// the bank port by <c>AddEnableBanking</c>, the <see cref="TimeProvider"/> by <c>AddSignIn</c>. Called from Program.cs,
  /// after <c>AddEnableBanking</c>.
  /// </summary>
  public static IServiceCollection AddBalance(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddScoped<ReadBalanceHandler>();

    return services;
  }
}