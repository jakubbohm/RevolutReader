using RevolutReader.Api.Account;
using RevolutReader.Api.Check;
using RevolutReader.Api.Push;
using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Storage;

/// <summary>
/// The stores' registrations on Table Storage: the transactions (c010 design.md D11), the push devices (c011 design.md
/// D11), the account check's balances (c014 design.md D4), the kept koruna rate (c017 design.md D2) and the first-seen
/// moments (c018 design.md D3).
/// </summary>
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

  /// <summary>
  /// The push device store (c011 design.md D11): binds <see cref="PushDeviceStoreOptions"/> from its section, validated on
  /// start, and <see cref="TablePushDeviceStore"/> as <see cref="IPushDeviceStore"/>, a singleton, so its table is created
  /// once per process. It uses the tables client <see cref="AddTransactionStore"/> registers, with its connection check, so
  /// Program.cs calls it after that one: a second client would be a second registration of the same connection.
  /// </summary>
  public static IHostApplicationBuilder AddPushDeviceStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.AddOptions<PushDeviceStoreOptions>()
      .BindConfiguration(PushDeviceStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    builder.Services.AddSingleton<IPushDeviceStore, TablePushDeviceStore>();

    return builder;
  }

  /// <summary>
  /// The account check's store of its two balances (c014 design.md D4): binds <see cref="CheckedBalanceStoreOptions"/> from
  /// its section, validated on start, and <see cref="TableCheckedBalanceStore"/> as <see cref="ICheckedBalanceStore"/>, a
  /// singleton, so its table is created once per process. Like <see cref="AddPushDeviceStore"/>, it uses the tables client
  /// <see cref="AddTransactionStore"/> registers, so Program.cs calls it after that one.
  /// </summary>
  public static IHostApplicationBuilder AddCheckedBalanceStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.AddOptions<CheckedBalanceStoreOptions>()
      .BindConfiguration(CheckedBalanceStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    builder.Services.AddSingleton<ICheckedBalanceStore, TableCheckedBalanceStore>();

    return builder;
  }

  /// <summary>
  /// The kept koruna rate's store (c017 design.md D2, D9): binds <see cref="KorunaRateStoreOptions"/> from its section,
  /// validated on start, and <see cref="TableKorunaRateStore"/> as <see cref="IKorunaRateStore"/>, a singleton, so its table
  /// is created once per process. Like <see cref="AddPushDeviceStore"/>, it uses the tables client
  /// <see cref="AddTransactionStore"/> registers, so Program.cs calls it after that one.
  /// </summary>
  public static IHostApplicationBuilder AddKorunaRateStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.AddOptions<KorunaRateStoreOptions>()
      .BindConfiguration(KorunaRateStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    builder.Services.AddSingleton<IKorunaRateStore, TableKorunaRateStore>();

    return builder;
  }

  /// <summary>
  /// The first-seen moments' store (c018 design.md D3, D9): binds <see cref="FirstSeenStoreOptions"/> from its section,
  /// validated on start, and <see cref="TableFirstSeenStore"/> as <see cref="IFirstSeenStore"/>, a singleton, so its table
  /// is created once per process. Like <see cref="AddKorunaRateStore"/>, it uses the tables client
  /// <see cref="AddTransactionStore"/> registers, so Program.cs calls it after that one.
  /// </summary>
  public static IHostApplicationBuilder AddFirstSeenStore(this IHostApplicationBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Services.AddOptions<FirstSeenStoreOptions>()
      .BindConfiguration(FirstSeenStoreOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();

    builder.Services.AddSingleton<IFirstSeenStore, TableFirstSeenStore>();

    return builder;
  }
}