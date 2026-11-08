using RevolutReader.Api.Account;

namespace RevolutReader.Api.Storage;

/// <summary>The transaction store's registration (c010 design.md D11).</summary>
public static class StorageRegistration {
  /// <summary>The connection's name, read from <c>ConnectionStrings:tables</c>.</summary>
  private const string TABLES = "tables";

  private const string NO_CONNECTION =
    $"The setting ConnectionStrings:{TABLES} is not set: the transaction store needs it (Azurite's connection string "
    + "locally and in tests, the storage account's table endpoint in Azure).";

  /// <summary>
  /// Throws at registration when <c>ConnectionStrings:tables</c> is missing, empty or only spaces, with a message that
  /// names the setting, never a value: the tables client checks it only when first resolved, which would answer the first
  /// transactions request with a 500 instead of stopping the app at start. Binds <see cref="TransactionStoreOptions"/>
  /// from its section, validated on start. Then Aspire's tables client from that connection, a singleton, with its health
  /// check off (spec service-health: <c>/health</c> never touches storage): Azurite's connection string locally and in
  /// tests; in Azure the table endpoint, which the client reaches with Azure.Identity's default credential, the app's
  /// managed identity whose client ID <c>AZURE_CLIENT_ID</c> holds. <see cref="TableTransactionStore"/> as the store, a
  /// singleton, so its table is created once per process.
  /// </summary>
  public static IHostApplicationBuilder AddTransactionStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    if (string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString(TABLES)))
      throw new InvalidOperationException(NO_CONNECTION);

    builder.Services.AddOptions<TransactionStoreOptions>()
      .BindConfiguration(TransactionStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    builder.AddAzureTableServiceClient(TABLES, static settings => settings.DisableHealthChecks = true);
    builder.Services.AddSingleton<ITransactionStore, TableTransactionStore>();

    return builder;
  }
}