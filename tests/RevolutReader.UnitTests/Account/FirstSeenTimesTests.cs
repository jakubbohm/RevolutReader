using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// How both readers record first sightings (c018 design.md D1, D3, § Public API sketch): <see cref="FirstSeenTimes"/>
/// reads the kept moments of the read's references, records the read's sightings only for references with none yet or a
/// later one (the earliest wins, D1), so a reference already timed earlier costs no write, and answers the kept moments
/// and the recorded ones together. The store is
/// <see cref="InMemoryFirstSeenStore"/>, whose kept moments are set before each test (<see cref="InMemoryFirstSeenStore.Keep"/>)
/// and which keeps what each request asked. A read at 13:40:00 UTC on 2026-11-20 lists the spec's payment, first read at
/// 13:05:12 UTC, and a new one. Moments are compared written out in the round-trip form (<c>O</c>). The references and
/// amounts are made up.
/// </summary>
public sealed class FirstSeenTimesTests {
  private static readonly DateOnly _november20 = new(2026, 11, 20);
  private static readonly DateOnly _november19 = new(2026, 11, 19);

  /// <summary>The spec's first read of the payment kept: 2026-11-20 13:05:12 UTC.</summary>
  private static readonly DateTimeOffset _firstRead = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <summary>This read: 2026-11-20 13:40:00 UTC.</summary>
  private static readonly DateTimeOffset _readAt = new(2026, 11, 20, 13, 40, 0, TimeSpan.Zero);

  /// <summary>
  /// The read lists the payment already timed, a new one and one without a reference: the store is asked for the two
  /// references, and only the new one is recorded, at this read's moment.
  /// </summary>
  [Test]
  public async Task FirstSeenTimes_reads_the_reads_references_and_records_only_those_with_no_moment_yet() {
    InMemoryFirstSeenStore store = new();
    store.Keep("e-c018-kavarna", _firstRead);

    _ = await new FirstSeenTimes(store).Record([
      Pending("e-c018-kavarna", _november20, -8.90m),
      Pending("e-c018-trafika", _november20, -3.80m),
      Pending(null, _november20, -1.20m),
    ], _readAt, CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => store.ReferencesRead.ShouldHaveSingleItem("the reads sent").ShouldBe(["e-c018-kavarna", "e-c018-trafika"], ignoreOrder: true, "the references read"),
      () => store.SightingsRecorded.ShouldHaveSingleItem("the records sent").Select(WrittenSighting)
        .ShouldBe(["e-c018-trafika 2026-11-20T13:40:00.0000000+00:00"], "the sightings recorded"));
  }

  /// <summary>
  /// The payment already timed today, one timed yesterday on yesterday's transaction, and a new one: the answer holds the
  /// two kept moments as kept and the new one as recorded.
  /// </summary>
  [Test]
  public async Task FirstSeenTimes_answers_the_kept_moments_and_the_newly_recorded_ones_together() {
    InMemoryFirstSeenStore store = new();
    store.Keep("e-c018-kavarna", _firstRead);
    store.Keep("e-c018-pekarna", new DateTimeOffset(2026, 11, 19, 18, 2, 45, TimeSpan.Zero));

    IReadOnlyDictionary<string, DateTimeOffset> kept = await new FirstSeenTimes(store).Record([
      Pending("e-c018-kavarna", _november20, -8.90m),
      Pending("e-c018-trafika", _november20, -3.80m),
      Pending("e-c018-pekarna", _november19, -12.30m) with { Status = TransactionStatus.Booked },
    ], _readAt, CancellationToken.None);

    kept.Select(WrittenMoment).ShouldBe([
      "e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00",
      "e-c018-pekarna 2026-11-19T18:02:45.0000000+00:00",
      "e-c018-trafika 2026-11-20T13:40:00.0000000+00:00",
    ], ignoreOrder: true);
  }

  /// <summary>
  /// A later read recorded first (another reader's 13:40:00 kept while this read, answered at 13:05:12, was on its way;
  /// or an app copy whose clock runs ahead): this read's earlier moment still wins, as the earliest moment wins whichever
  /// read writes first (design.md D1, § Risks). The store keeps it, and the answer gives it.
  /// </summary>
  [Test]
  public async Task FirstSeenTimes_keeps_and_answers_a_reads_earlier_moment_when_a_later_one_was_kept_first() {
    InMemoryFirstSeenStore store = new();
    store.Keep("e-c018-kavarna", _readAt);

    IReadOnlyDictionary<string, DateTimeOffset> answered = await new FirstSeenTimes(store).Record([
      Pending("e-c018-kavarna", _november20, -8.90m),
    ], _firstRead, CancellationToken.None);

    IReadOnlyDictionary<string, DateTimeOffset> keptAfter = await store.Read(["e-c018-kavarna"], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => keptAfter.Select(WrittenMoment).ShouldBe(["e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00"], "the moment kept"),
      () => answered.Select(WrittenMoment).ShouldBe(["e-c018-kavarna 2026-11-20T13:05:12.0000000+00:00"], "the moment answered"));
  }

  /// <summary>A pending card payment of <paramref name="amount"/> EUR on <paramref name="date"/>, with this reference or none.</summary>
  private static BankTransaction Pending(string? reference, DateOnly date, decimal amount) => new(
    Reference: reference,
    Status: TransactionStatus.Pending,
    Date: date,
    Amount: amount,
    Currency: "EUR",
    Counterparty: "Kavárna Na Rohu",
    PaymentDetails: [],
    TypeCode: "CARD_PAYMENT");

  /// <summary>A kept moment as <c>reference moment</c>, the moment in the round-trip form.</summary>
  private static string WrittenMoment(KeyValuePair<string, DateTimeOffset> moment) => WrittenSighting(new FirstSeen(moment.Key, moment.Value));

  /// <summary>A sighting as <c>reference moment</c>, the moment in the round-trip form.</summary>
  private static string WrittenSighting(FirstSeen sighting) => $"{sighting.Reference} {sighting.At.ToString("O", CultureInfo.InvariantCulture)}";
}