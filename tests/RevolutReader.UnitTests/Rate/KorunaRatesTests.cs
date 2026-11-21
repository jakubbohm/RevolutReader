using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The rate an answer carries, the happy path (c017 design.md D2–D4; § Public API sketch, <see cref="IKorunaRates"/>): with
/// nothing kept, the CNB is asked, and its rate is answered and saved; the kept rate is read from the store once per
/// instance, on the first call that needs a rate; a kept rate that is not due is answered without asking the CNB. The CNB
/// is a hand-written fake of the port (<see cref="FakeCnbRates"/>), the kept rate an in-memory store
/// (<see cref="InMemoryKorunaRateStore"/>), the clock a <see cref="FakeTimeProvider"/>. The rates and days are the spec's:
/// Friday 2026-11-20's and Monday 2026-11-23's.
/// </summary>
public sealed class KorunaRatesTests {
  /// <summary>Friday's rate, kept over the weekend.</summary>
  private static readonly KorunaRate _fridays = new(24.41m, new DateOnly(2026, 11, 20));

  /// <summary>Monday's rate, the CNB's latest.</summary>
  private static readonly KorunaRate _mondays = new(24.52m, new DateOnly(2026, 11, 23));

  /// <summary>Monday 2026-11-23 at 15:00 UTC, after Monday's 08:00 UTC: a rate kept for Friday would be due.</summary>
  private static readonly DateTimeOffset _mondayAfternoon = new(2026, 11, 23, 15, 0, 0, TimeSpan.Zero);

  /// <summary>Saturday 2026-11-21 at 10:00 UTC, before Monday's 08:00 UTC: a rate kept for Friday is not due.</summary>
  private static readonly DateTimeOffset _saturdayMorning = new(2026, 11, 21, 10, 0, 0, TimeSpan.Zero);

  [Test]
  public async Task With_nothing_kept_the_CNB_is_asked_and_its_rate_is_answered() {
    FakeCnbRates cnb = new(_mondays);
    KorunaRates rates = RatesWith(cnb, new InMemoryKorunaRateStore(), _mondayAfternoon);

    KorunaRate rate = await rates.Current(CancellationToken.None);

    rate.ShouldSatisfyAllConditions(
      () => rate.ShouldBe(_mondays, "the CNB's rate"),
      () => cnb.Calls.ShouldBe(1, "the CNB is asked once"));
  }

  [Test]
  public async Task A_rate_the_CNB_answers_with_nothing_kept_is_saved_in_the_store() {
    InMemoryKorunaRateStore store = new();
    KorunaRates rates = RatesWith(new FakeCnbRates(_mondays), store, _mondayAfternoon);

    _ = await rates.Current(CancellationToken.None);

    (await store.Read(CancellationToken.None)).ShouldBe(_mondays, "the rate kept in the store");
  }

  /// <summary>
  /// On a Saturday, so Friday's kept rate is not due and nothing but the first call's read touches the store. A second
  /// instance over the same store reads it again: the read is the instance's, not the process's alone.
  /// </summary>
  [Test]
  public async Task The_kept_rate_is_read_from_the_store_once_per_instance_on_the_first_call() {
    InMemoryKorunaRateStore store = await StoreKeeping(_fridays);
    KorunaRates rates = RatesWith(new FakeCnbRates(_mondays), store, _saturdayMorning);
    int readsBeforeTheFirstCall = store.Reads;

    _ = await rates.Current(CancellationToken.None);
    int readsAfterTheFirstCall = store.Reads;
    _ = await rates.Current(CancellationToken.None);
    _ = await rates.Current(CancellationToken.None);
    int readsAfterThreeCalls = store.Reads;
    _ = await RatesWith(new FakeCnbRates(_mondays), store, _saturdayMorning).Current(CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => readsBeforeTheFirstCall.ShouldBe(0, "no read before the first call"),
      () => readsAfterTheFirstCall.ShouldBe(1, "one read, on the first call"),
      () => readsAfterThreeCalls.ShouldBe(1, "no read on the later calls"),
      () => store.Reads.ShouldBe(2, "a second instance reads it once more, on its own first call"));
  }

  [Test]
  public async Task A_rate_kept_in_the_store_and_not_due_is_answered_without_asking_the_CNB() {
    FakeCnbRates cnb = new(_mondays);
    KorunaRates rates = RatesWith(cnb, await StoreKeeping(_fridays), _saturdayMorning);

    KorunaRate rate = await rates.Current(CancellationToken.None);

    rate.ShouldSatisfyAllConditions(
      () => rate.ShouldBe(_fridays, "the kept rate"),
      () => cnb.Calls.ShouldBe(0, "the CNB is not asked"));
  }

  /// <summary>The service under test, asking <paramref name="cnb"/>, keeping its rate in <paramref name="store"/>, with the clock at <paramref name="now"/>.</summary>
  private static KorunaRates RatesWith(FakeCnbRates cnb, InMemoryKorunaRateStore store, DateTimeOffset now) =>
    new(cnb, store, new FakeTimeProvider(now), NullLogger<KorunaRates>.Instance);

  /// <summary>A store keeping <paramref name="rate"/>, saved before the service exists, so no read is counted yet.</summary>
  private static async Task<InMemoryKorunaRateStore> StoreKeeping(KorunaRate rate) {
    InMemoryKorunaRateStore store = new();
    await store.Save(rate, CancellationToken.None);

    return store;
  }
}