using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Azure.Core.Pipeline;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The adapter's lost race (c018 design.md D3, § Ports and contracts: "two <c>Record</c> calls at once for one reference
/// keep the earlier moment (an insert, then an ETag-guarded replace, retried on a lost race)"), forced on every run rather
/// than hoped for. The row already holds a later moment, so the store's insert conflicts, it reads the row, and it
/// replaces the row under the ETag it read. Its tables client sends through a handler that, just before the first such
/// guarded write leaves, writes the row as another caller would (straight into the table, on a client of its own), so the
/// guarded write always meets a changed row and loses. Nothing waits on time: the other write is awaited before the guarded
/// one is sent. Two cases, by what the other caller wrote:
/// <list type="bullet">
/// <item>a moment earlier than the store's own: the store keeps it, and answers it;</item>
/// <item>a moment still later than the store's own: the store tries again and replaces it with its own.</item>
/// </list>
/// The handler also counts the guarded writes it saw, so a store that never replaces under an ETag fails here rather than
/// passing without a race. Each test writes to a table of its own on the test session's Azurite
/// (<see cref="AzuriteTables"/>); the reference and the moments are made up. Written by the test-writer before the
/// conflict path (tasks.md 8.4), as an adapter edge case.
/// </summary>
public sealed class FirstSeenRaceTests {
  /// <summary>The row's reference (made up), whose hash is its row key.</summary>
  private const string REFERENCE = "e-c018-race";

  /// <summary>The column the store keeps the moment in (D3).</summary>
  private const string SEEN_AT = "SeenAt";

  /// <summary>The store's own sighting: 2026-11-20 13:05:12 UTC.</summary>
  private static readonly DateTimeOffset _ours = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <summary>What the row holds before the store's call: a later moment, 15:00:00 UTC.</summary>
  private static readonly DateTimeOffset _keptBefore = new(2026, 11, 20, 15, 0, 0, TimeSpan.Zero);

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="otherWrite">What the other caller writes between the store's read of the row and its guarded write.</param>
  /// <param name="expected">The moment the store keeps and answers, in the round-trip form.</param>
  [Test]
  [Arguments("an earlier moment", "2026-11-20T11:00:00.0000000+00:00")]
  [Arguments("a moment still later than the store's", "2026-11-20T13:05:12.0000000+00:00")]
  public async Task A_lost_race_keeps_the_earlier_moment(string otherWrite, string expected) {
    DateTimeOffset otherMoment = otherWrite switch {
      "an earlier moment" => new DateTimeOffset(2026, 11, 20, 11, 0, 0, TimeSpan.Zero),
      "a moment still later than the store's" => new DateTimeOffset(2026, 11, 20, 14, 0, 0, TimeSpan.Zero),
      _ => throw new ArgumentOutOfRangeException(nameof(otherWrite), otherWrite, "Not a known case."),
    };
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await WriteRow(table, _keptBefore);

    using HttpClientHandler toAzurite = new();
    using OtherCallerFirst handler = new(toAzurite, () => WriteRow(table, otherMoment));
    using HttpClientTransport transport = new(handler);
    TableServiceClient racingTables = new(Azurite.ConnectionString, new TableClientOptions { Transport = transport });
    TableFirstSeenStore store = new(racingTables, Options.Create(new FirstSeenStoreOptions { TableName = tableName }));

    // A bound for a store that would try again forever, never a wait: the test ends as soon as the store does.
    using CancellationTokenSource bound = new(TimeSpan.FromSeconds(30));
    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record([new FirstSeen(REFERENCE, _ours)], bound.Token);
    IReadOnlyDictionary<string, DateTimeOffset> read = await new TableFirstSeenStore(Azurite.Tables, Options.Create(new FirstSeenStoreOptions { TableName = tableName }))
      .Read([REFERENCE], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => handler.GuardedWrites.ShouldBeGreaterThan(0, "the store's writes under the row's ETag: the race needs one"),
      () => recorded.Select(Written).ShouldBe([$"{REFERENCE} {expected}"], "what Record answers"),
      () => read.Select(Written).ShouldBe([$"{REFERENCE} {expected}"], "what the table keeps"));
  }

  /// <summary>Writes the row of <see cref="REFERENCE"/> straight into the table, as the store does, holding <paramref name="seenAt"/>, whatever it held.</summary>
  private static async Task WriteRow(TableClient table, DateTimeOffset seenAt) =>
    _ = await table.UpsertEntityAsync(new TableEntity("account", RowKey(REFERENCE)) { [SEEN_AT] = seenAt }, TableUpdateMode.Replace);

  /// <summary>The row key of a reference: the SHA-256 of its UTF-8 bytes, in lowercase hex (D3, as the transactions table's).</summary>
  private static string RowKey(string reference) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(reference)));

  /// <summary>A kept moment as <c>reference moment</c>, the moment in the round-trip form.</summary>
  private static string Written(KeyValuePair<string, DateTimeOffset> moment) =>
    $"{moment.Key} {moment.Value.ToString("O", CultureInfo.InvariantCulture)}";

  /// <summary>
  /// The HTTP handler under the store's tables client: before the first request guarded by an ETag (an <c>If-Match</c>
  /// other than <c>*</c>) is sent on, it runs the other caller's write and awaits it; every request after goes on as it is.
  /// It counts the guarded requests it saw.
  /// </summary>
  private sealed class OtherCallerFirst(HttpMessageHandler toAzurite, Func<Task> otherWrite) : DelegatingHandler(toAzurite) {
    private int _guardedWrites;

    /// <summary>How many requests guarded by an ETag were sent so far.</summary>
    public int GuardedWrites => Volatile.Read(ref _guardedWrites);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
      bool guarded = request.Headers.TryGetValues("If-Match", out IEnumerable<string>? tags) && tags.Any(static tag => tag != "*");

      if (guarded && Interlocked.Increment(ref _guardedWrites) == 1)
        await otherWrite();

      return await base.SendAsync(request, cancellationToken);
    }
  }
}