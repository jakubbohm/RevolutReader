using Azure;
using Azure.Data.Tables;
using Azure.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.HistoryImport;

/// <summary>
/// The history import (c010 design.md D9), run once by the owner after the merge deploys: the M1 history file read by
/// <see cref="HistoryFile"/> and imported by <see cref="HistoryImporter"/> through the real Table adapter
/// (<see cref="TableTransactionStore"/>) into the app's table, <see cref="TABLE_NAME"/>. Running it twice changes nothing.
/// <para>
/// Its settings come from environment variables only (none is a secret, and none stays on the machine once the shell
/// closes):
/// </para>
/// <list type="bullet">
/// <item><c>HistoryImport:File</c> (<c>HistoryImport__File</c>): the history file's full path.</item>
/// <item>Either <c>HistoryImport:TableEndpoint</c>, the deployed storage account's table endpoint, written to with the
/// owner's Azure CLI login (<see cref="AzureCliCredential"/>), together with <c>HistoryImport:Subscription</c>, the
/// owner's subscription, which the credential's <c>az account get-access-token</c> names, as every <c>az</c> command does
/// (docs/operations/azure-prerequisites.md);</item>
/// <item>or <c>HistoryImport:TableConnectionString</c> instead, for the local check on Azurite
/// (<c>UseDevelopmentStorage=true</c>), which takes no Azure login.</item>
/// </list>
/// Explicit: <c>dotnet test</c> and CI never run it. It prints counts only, never a value from the file; its errors name
/// what failed and quote nothing (§ Error model): a refusal from the storage is reduced to its status and error code.
/// </summary>
[Explicit]
[Category("HistoryImport")]
public sealed class HistoryImportCheck {
  /// <summary>The table the app keeps transactions in: the <c>Transactions:TableName</c> default in appsettings.json, the table Bicep creates.</summary>
  private const string TABLE_NAME = "transactions";

  private const string FILE = "HistoryImport:File";
  private const string TABLE_ENDPOINT = "HistoryImport:TableEndpoint";
  private const string SUBSCRIPTION = "HistoryImport:Subscription";
  private const string TABLE_CONNECTION_STRING = "HistoryImport:TableConnectionString";

  [Test]
  public async Task The_history_file_is_kept_in_the_table_and_counted() {
    // First, so a missing setting stops the check before the file is opened or the table reached.
    IConfiguration settings = new ConfigurationBuilder().AddEnvironmentVariables().Build();
    string path = FilePath(settings);
    (TableServiceClient tables, string through) = Tables(settings);

    HistoryFile history = await Read(path);
    TableTransactionStore store = new(tables, Options.Create(new TransactionStoreOptions { TableName = TABLE_NAME }));

    HistoryImportCounts counts = await Stored(() => new HistoryImporter(store).Import(history, CancellationToken.None));
    int rows = (await Stored(() => store.ReadAll(CancellationToken.None))).Count;

    Console.WriteLine($"History import into the table {TABLE_NAME}, through {through}");
    Console.WriteLine($"Transactions read: {counts.Read}");
    Console.WriteLine($"Settled: {counts.Settled}");
    Console.WriteLine($"Kept: {counts.Kept}");
    Console.WriteLine($"Days skipped: {counts.DaysSkipped}");
    Console.WriteLine($"Rows in the table: {rows}");

    rows.ShouldBeGreaterThanOrEqualTo(counts.Kept, "the table holds at least the transactions the import kept");
  }

  /// <summary>The file's full path from <see cref="FILE"/>; a missing setting, a relative path or no such file fails, never quoting the path.</summary>
  private static string FilePath(IConfiguration settings) {
    string? path = settings[FILE];

    if (string.IsNullOrWhiteSpace(path))
      throw new InvalidOperationException($"Set {FILE} (environment variable {EnvironmentVariable(FILE)}) to the history file's full path.");

    if (!Path.IsPathFullyQualified(path))
      throw new InvalidOperationException($"{FILE} must be the history file's full path.");

    return File.Exists(path) ? path : throw new InvalidOperationException($"{FILE} names no file that exists.");
  }

  /// <summary>
  /// The table service: the deployed one at <see cref="TABLE_ENDPOINT"/> with the owner's Azure CLI login in
  /// <see cref="SUBSCRIPTION"/>, or the one at <see cref="TABLE_CONNECTION_STRING"/>; exactly one of the two. Also which
  /// setting it came from, never its value.
  /// </summary>
  private static (TableServiceClient Tables, string Through) Tables(IConfiguration settings) {
    string? endpoint = settings[TABLE_ENDPOINT];
    string? connectionString = settings[TABLE_CONNECTION_STRING];
    bool hasEndpoint = !string.IsNullOrWhiteSpace(endpoint);
    bool hasConnectionString = !string.IsNullOrWhiteSpace(connectionString);

    if (hasEndpoint == hasConnectionString)
      throw new InvalidOperationException(
        $"Set exactly one of {TABLE_ENDPOINT} (the deployed table, with {SUBSCRIPTION}) and {TABLE_CONNECTION_STRING} (the local check on Azurite); now {(hasEndpoint ? "both are" : "neither is")} set.");

    if (hasConnectionString)
      return (new TableServiceClient(connectionString), TABLE_CONNECTION_STRING);

    if (!Uri.TryCreate(endpoint, UriKind.Absolute, out Uri? address) || address.Scheme != Uri.UriSchemeHttps)
      throw new InvalidOperationException($"{TABLE_ENDPOINT} must be the storage account's https table endpoint.");

    string? subscription = settings[SUBSCRIPTION];

    if (string.IsNullOrWhiteSpace(subscription))
      throw new InvalidOperationException(
        $"Set {SUBSCRIPTION} (environment variable {EnvironmentVariable(SUBSCRIPTION)}) to the owner's subscription (docs/operations/azure-prerequisites.md): the Azure CLI login's token comes from it.");

    return (new TableServiceClient(address, new AzureCliCredential(new AzureCliCredentialOptions { Subscription = subscription })), TABLE_ENDPOINT);
  }

  /// <summary>The history file, read whole by <see cref="HistoryFile.Read"/>, whose errors name what and quote nothing.</summary>
  private static async Task<HistoryFile> Read(string path) {
    await using FileStream json = File.OpenRead(path);

    return await HistoryFile.Read(json, CancellationToken.None);
  }

  /// <summary>
  /// The result of a call that reaches the table; a refusal from the storage becomes an error naming its status and error
  /// code only, since the storage's own message carries the answer's content.
  /// </summary>
  private static async Task<T> Stored<T>(Func<Task<T>> call) {
    try {
      return await call();
    }
    catch (RequestFailedException exception) {
      throw new InvalidOperationException(
        $"The table refused a request: status {exception.Status}, error code {exception.ErrorCode ?? "(none)"}. The days kept before it stay kept; running the check again imports the rest.");
    }
  }

  /// <summary>The environment variable that sets <paramref name="setting"/>: its colons as double underscores.</summary>
  private static string EnvironmentVariable(string setting) => setting.Replace(":", "__", StringComparison.Ordinal);
}