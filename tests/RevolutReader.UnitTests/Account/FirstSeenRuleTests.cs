using System.Globalization;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The first-seen time's rules (c018 design.md D1, D2), pure: the moment a read got its answer
/// (<see cref="FirstSeenRule.ReadAt"/>), what a read records (<see cref="FirstSeenRule.Sightings"/>) and what a page
/// answers for a kept moment (<see cref="FirstSeenRule.Shown"/>). Moments are compared written out in the round-trip form
/// (<c>O</c>), so the offset and every fraction of a second count, not only the instant. The references and amounts are
/// made up.
/// </summary>
public sealed class FirstSeenRuleTests {
  /// <summary>2026-11-20, the spec's day.</summary>
  private static readonly DateOnly _november20 = new(2026, 11, 20);

  /// <summary>The spec's moment: 2026-11-20 13:05:12 UTC.</summary>
  private static readonly DateTimeOffset _readAt = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <summary>
  /// The clock's time is taken at offset zero and cut, never rounded, to the whole second: a clock just short of the next
  /// second, at an offset of its own, gives 13:05:12 UTC.
  /// </summary>
  /// <param name="now">The clock's time, in the round-trip form.</param>
  [Test]
  [Arguments("2026-11-20T13:05:12.0000000+00:00")]
  [Arguments("2026-11-20T13:05:12.9999999+00:00")]
  [Arguments("2026-11-20T14:05:12.5000000+01:00")]
  public void The_moment_a_read_got_its_answer_is_the_clock_at_offset_zero_cut_to_the_whole_second(string now) {
    DateTimeOffset readAt = FirstSeenRule.ReadAt(DateTimeOffset.ParseExact(now, "O", CultureInfo.InvariantCulture));

    Written(readAt).ShouldBe("2026-11-20T13:05:12.0000000+00:00");
  }

  /// <summary>A pending card payment of today, with the bank's reference, read at 13:05:12 UTC: recorded at that moment.</summary>
  [Test]
  public void A_read_records_a_pending_transaction_with_a_reference_dated_the_reads_UTC_day_at_the_reads_moment() {
    BankTransaction pending = new(
      Reference: "e-c018-kavarna",
      Status: TransactionStatus.Pending,
      Date: _november20,
      Amount: -8.90m,
      Currency: "EUR",
      Counterparty: "Kavárna Na Rohu",
      PaymentDetails: [],
      TypeCode: "CARD_PAYMENT");

    IReadOnlyList<FirstSeen> sightings = FirstSeenRule.Sightings([pending], _readAt);

    FirstSeen sighting = sightings.ShouldHaveSingleItem("the read's one sighting");
    sighting.ShouldSatisfyAllConditions(
      () => sighting.Reference.ShouldBe("e-c018-kavarna"),
      () => Written(sighting.At).ShouldBe("2026-11-20T13:05:12.0000000+00:00"));
  }

  /// <summary>A moment kept for a transaction dated 2026-11-20, anywhere in that UTC day, its first and its last second included: answered as kept.</summary>
  /// <param name="kept">The kept moment, in the round-trip form.</param>
  [Test]
  [Arguments("2026-11-20T00:00:00.0000000+00:00")]
  [Arguments("2026-11-20T13:05:12.0000000+00:00")]
  [Arguments("2026-11-20T23:59:59.0000000+00:00")]
  public void A_kept_moment_on_the_transactions_own_UTC_day_is_answered(string kept) {
    DateTimeOffset? shown = FirstSeenRule.Shown(_november20, DateTimeOffset.ParseExact(kept, "O", CultureInfo.InvariantCulture));

    Written(shown.ShouldNotBeNull("the kept moment")).ShouldBe(kept);
  }

  /// <summary>A moment written out with its offset and every fraction of a second.</summary>
  private static string Written(DateTimeOffset moment) => moment.ToString("O", CultureInfo.InvariantCulture);
}