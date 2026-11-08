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
  /// from its section, validated on start.
  /// </summary>
  public static IHostApplicationBuilder AddTransactionStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    if (string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString(TABLES)))
      throw new InvalidOperationException(NO_CONNECTION);

    builder.Services.AddOptions<TransactionStoreOptions>()
      .BindConfiguration(TransactionStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    // Not yet: AddAzureTableServiceClient(TABLES) and TableTransactionStore as the store come with c010 task 7.1.
    return builder;
  }
}