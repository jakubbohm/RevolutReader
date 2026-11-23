using System.Globalization;
using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>
/// The contract of the first-seen moments' store (c018 design.md § Ports and contracts, D3), written only against
/// <see cref="IFirstSeenStore"/>, and run against both the in-memory fake the unit tests use
/// (<see cref="InMemoryFirstSeenStoreContract"/>) and the Table adapter on Azurite
/// (<see cref="TableFirstSeenStoreContract"/>), so the fake stays honest:
/// <list type="bullet">
/// <item><c>Read</c>: the kept moment of each reference asked for that has one; a reference never recorded is absent,
/// never an error; a reference not asked for is not answered.</item>
/// <item><c>Record</c>: keeps the moment and answers the moment kept for each sighting's reference.</item>
/// <item>Values: a moment comes back exactly as given, at offset zero and to the second; a reference with any characters,
/// <c>/ \ # ?</c> and <c>%</c> among them, is recorded and read back.</item>
/// </list>
/// "Nothing asked or nothing to record: no request" is each implementation's own test (tasks.md 4.5: the fake's counts,
/// the adapter's requests). Each test starts from a new, empty store of its own (<see cref="NewStore"/>: for the adapter,
/// a table no other test uses), so its made-up references are its own. Moments are compared written out in the
/// round-trip form (<c>O</c>), so the offset and every fraction of a second count, not only the instant.
/// </summary>
public abstract class FirstSeenStoreContract {
  /// <summary>The spec's first read: 2026-11-20 13:05:12 UTC.</summary>
  private static readonly DateTimeOffset _firstRead = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <param name="store">An empty store; or one holding another reference.</param>
  [Test]
  [Arguments("empty")]
  [Arguments("holding another reference")]
  public async Task A_reference_never_recorded_reads_as_absent(string store) {
    IFirstSeenStore firstSeen = NewStore();

    if (store == "holding another reference")
      _ = await firstSeen.Record([new FirstSeen("e-c018-other", _firstRead)], CancellationToken.None);
    else if (store != "empty")
      throw new ArgumentOutOfRangeException(nameof(store), store, "Not a known case.");

    (await firstSeen.Read(["e-c018-never"], CancellationToken.None)).ShouldBeEmpty("the moments read");
  }

  [Test]
  public async Task A_recorded_moment_reads_back_exactly_in_UTC_to_the_second_and_Record_answers_it() {
    IFirstSeenStore store = NewStore();

    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record([new FirstSeen("e-c018-kavarna", _firstRead)], CancellationToken.None);
    IReadOnlyDictionary<string, DateTimeOffset> read = await store.Read(["e-c018-kavarna"], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => Written(recorded).ShouldBe(["e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00"], "what Record answers"),
      () => Written(read).ShouldBe(["e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00"], "what Read answers"));
  }

  /// <summary>Two references recorded; a read asks for one of them and for one never recorded: only the first is answered.</summary>
  [Test]
  public async Task Only_the_references_asked_for_are_answered() {
    IFirstSeenStore store = NewStore();
    _ = await store.Record([
      new FirstSeen("e-c018-kavarna", _firstRead),
      new FirstSeen("e-c018-pekarna", _firstRead.AddMinutes(20)),
    ], CancellationToken.None);

    IReadOnlyDictionary<string, DateTimeOffset> read = await store.Read(["e-c018-kavarna", "e-c018-never"], CancellationToken.None);

    Written(read).ShouldBe(["e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00"]);
  }

  /// <param name="reference">A made-up reference with each of the characters a table's row key refuses or a URL reads otherwise, and with all of them.</param>
  [Test]
  [Arguments("e-c018/kavarna")]
  [Arguments(@"e-c018\kavarna")]
  [Arguments("e-c018#kavarna")]
  [Arguments("e-c018?kavarna")]
  [Arguments("e-c018%2Fkavarna")]
  [Arguments(@"e-c018/\#?%kavarna")]
  public async Task A_reference_with_slashes_hashes_question_marks_and_percent_signs_is_recorded_and_read_back(string reference) {
    IFirstSeenStore store = NewStore();

    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record([new FirstSeen(reference, _firstRead)], CancellationToken.None);
    IReadOnlyDictionary<string, DateTimeOffset> read = await store.Read([reference], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => Written(recorded).ShouldBe([$"{reference} 2026-11-20T13:05:12.0000000+00:00"], "what Record answers"),
      () => Written(read).ShouldBe([$"{reference} 2026-11-20T13:05:12.0000000+00:00"], "what Read answers"));
  }

  /// <summary>A new, empty store of the test's own.</summary>
  protected abstract IFirstSeenStore NewStore();

  /// <summary>
  /// The answer written out, one <c>reference moment</c> per entry, the moment in the round-trip form (<c>O</c>), in
  /// ordinal order of the reference, as an answer is a map with no order of its own.
  /// </summary>
  private static string[] Written(IReadOnlyDictionary<string, DateTimeOffset> answer) => [
    .. answer
      .OrderBy(static moment => moment.Key, StringComparer.Ordinal)
      .Select(static moment => $"{moment.Key} {moment.Value.ToString("O", CultureInfo.InvariantCulture)}"),
  ];
}