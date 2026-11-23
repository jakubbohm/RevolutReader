using Azure.Core.Pipeline;
using Azure.Data.Tables;
using Azure.Data.Tables.Models;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>
/// The store's contract (<see cref="FirstSeenStoreContract"/>) on the Table adapter, against the test session's Azurite
/// (<see cref="AzuriteTables"/>): each test's store writes to a table no other test uses, which nothing creates before the
/// store does (D3: the adapter creates its table if it is missing, as the other stores' <c>TableCreation</c>). Two cases
/// are the adapter's alone: nothing to read or record sends no request, the table's creation included (tasks.md 4.5); and
/// the table is created when missing, before the store's first read (4.6).
/// </summary>
[InheritsTests]
public sealed class TableFirstSeenStoreContract : FirstSeenStoreContract {
  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <summary>
  /// The store's tables client sends through a transport that counts its requests: an empty read and an empty record send
  /// none, not even the table's creation; a read that asks for a reference then does, so the count is seen to work.
  /// </summary>
  [Test]
  public async Task Nothing_to_read_or_record_sends_no_request() {
    using HttpClientHandler toAzurite = new();
    using RequestCounter counter = new(toAzurite);
    using HttpClientTransport transport = new(counter);
    TableServiceClient tables = new(Azurite.ConnectionString, new TableClientOptions { Transport = transport });
    TableFirstSeenStore store = new(tables, Options.Create(new FirstSeenStoreOptions { TableName = AzuriteTables.UniqueTableName() }));

    IReadOnlyDictionary<string, DateTimeOffset> read = await store.Read([], CancellationToken.None);
    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record([], CancellationToken.None);
    int requestsForNothing = counter.Requests;
    _ = await store.Read(["e-c018-kavarna"], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => read.ShouldBeEmpty("what Read answers"),
      () => recorded.ShouldBeEmpty("what Record answers"),
      () => requestsForNothing.ShouldBe(0, "the requests sent for nothing"),
      () => counter.Requests.ShouldBeGreaterThan(0, "the requests sent for a reference: the counter sees the store's requests"));
  }

  /// <summary>
  /// A table that is missing, as on a first start, is created by the store's first read, which finds nothing kept; a moment
  /// recorded next reads back.
  /// </summary>
  [Test]
  public async Task The_table_is_created_when_missing() {
    string tableName = AzuriteTables.UniqueTableName();
    bool existedBefore = await TableExists(tableName);
    TableFirstSeenStore store = StoreOn(tableName);
    DateTimeOffset firstRead = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

    IReadOnlyDictionary<string, DateTimeOffset> readFirst = await store.Read(["e-c018-kavarna"], CancellationToken.None);
    bool existsAfterTheRead = await TableExists(tableName);
    _ = await store.Record([new FirstSeen("e-c018-kavarna", firstRead)], CancellationToken.None);

    IReadOnlyDictionary<string, DateTimeOffset> readNext = await store.Read(["e-c018-kavarna"], CancellationToken.None);
    store.ShouldSatisfyAllConditions(
      () => existedBefore.ShouldBeFalse("no table before the store"),
      () => readFirst.ShouldBeEmpty("the first read finds nothing kept"),
      () => existsAfterTheRead.ShouldBeTrue("the table, created by the store's first read"),
      () => readNext.Keys.ShouldBe(["e-c018-kavarna"], "the reference recorded into the table it created"));
  }

  protected override IFirstSeenStore NewStore() => StoreOn(AzuriteTables.UniqueTableName());

  /// <summary>The Table adapter on the table <paramref name="tableName"/> of the test session's Azurite.</summary>
  private TableFirstSeenStore StoreOn(string tableName) =>
    new(Azurite.Tables, Options.Create(new FirstSeenStoreOptions { TableName = tableName }));

  /// <summary>Whether the test session's Azurite has a table named <paramref name="tableName"/>.</summary>
  private async Task<bool> TableExists(string tableName) {
    await foreach (TableItem table in Azurite.Tables.QueryAsync(table => table.Name == tableName))
      return true;

    return false;
  }

  /// <summary>The HTTP handler under a tables client's transport, counting every request it sends on to Azurite.</summary>
  private sealed class RequestCounter : DelegatingHandler {
    private int _requests;

    public RequestCounter(HttpMessageHandler toAzurite) : base(toAzurite) { }

    /// <summary>How many requests were sent so far.</summary>
    public int Requests => Volatile.Read(ref _requests);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
      _ = Interlocked.Increment(ref _requests);

      return base.SendAsync(request, cancellationToken);
    }
  }
}