namespace RevolutReader.Api.Account;

/// <summary>The transactions' production wiring (c010 design.md § Public API sketch).</summary>
public static class TransactionsRegistration {
  /// <summary>
  /// <see cref="ReadNewestTransactionsHandler"/>, scoped, for <see cref="NewestTransactionsEndpoint"/>. What it reads with
  /// is registered elsewhere: the bank port and the <see cref="TimeProvider"/> by <c>AddEnableBanking</c>, the store by
  /// <c>AddTransactionStore</c>. Called from Program.cs, after both.
  /// </summary>
  public static IServiceCollection AddTransactions(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddScoped<ReadNewestTransactionsHandler>();

    return services;
  }
}