namespace RevolutReader.Api.Account;

/// <summary>The transactions' production wiring (c010 design.md § Public API sketch).</summary>
public static class TransactionsRegistration {
  /// <summary>
  /// The two handlers, scoped, and <see cref="FirstSeenTimes"/>, scoped, how the newest page records first sightings
  /// (c018 design.md D9): <see cref="ReadNewestTransactionsHandler"/> for <see cref="NewestTransactionsEndpoint"/> and
  /// <see cref="ReadOlderTransactionsHandler"/> for <see cref="OlderTransactionsEndpoint"/>. What they read with is
  /// registered elsewhere: the bank port and the <see cref="TimeProvider"/> by <c>AddEnableBanking</c>, the store by
  /// <c>AddTransactionStore</c>, the first-seen store by <c>AddFirstSeenStore</c>, the koruna rate by <c>AddKorunaRates</c>
  /// (c017 design.md D8). Called from Program.cs, after all four.
  /// </summary>
  public static IServiceCollection AddTransactions(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddScoped<FirstSeenTimes>();
    services.AddScoped<ReadNewestTransactionsHandler>();
    services.AddScoped<ReadOlderTransactionsHandler>();

    return services;
  }
}