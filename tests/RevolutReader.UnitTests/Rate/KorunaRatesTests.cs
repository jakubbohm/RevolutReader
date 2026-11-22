using Azure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The rate an answer carries (c017 design.md D2–D4, D7; § Public API sketch, <see cref="IKorunaRates"/>). The happy path:
/// with nothing kept, the CNB is asked, and its rate is answered and saved; the kept rate is read from the store once per
/// instance, on the first call that needs a rate; a kept rate that is not due is answered without asking the CNB. When it
/// is asked again: a later day's rate replaces the kept one and is logged as kept; after a rate for today is kept, the CNB
/// is not asked again before the next weekday's 08:00 UTC; a rate for the kept day changes nothing, and every call asks
/// until a later day's comes; callers at the same time share one ask, which a leaving caller leaves to the others and which
/// is not shared once it has ended; an earlier day's rate is answered as the kept one. When something fails (D5): a failed
/// ask answers the kept rate and is logged with its kind; a store that fails to read counts as nothing kept and is read
/// again; one that fails to save still answers and holds the new rate; with nothing kept and a failed ask, the app's own
/// rate is answered and never saved. A wait that must end by itself is bounded on the real clock
/// (<see cref="WITHIN_SECONDS"/>), never a pause. The CNB is a hand-written fake of the port (<see cref="FakeCnbRates"/>),
/// the kept rate an in-memory store (<see cref="InMemoryKorunaRateStore"/>, behind <see cref="UnreliableStore"/> when it
/// fails), the clock a <see cref="FakeTimeProvider"/>, the log a hand-written logger (<see cref="CapturedLog"/>). The rates
/// and days are the spec's: Friday 2026-11-20's and Monday 2026-11-23's.
/// </summary>
public sealed class KorunaRatesTests {
  /// <summary>The events of the service's lines (D7): a newly kept rate, a failed ask, a store that failed.</summary>
  private const string KORUNA_RATE_KEPT = "KorunaRateKept";
  private const string KORUNA_RATE_ASK_FAILED = "KorunaRateAskFailed";
  private const string KORUNA_RATE_STORE_FAILED = "KorunaRateStoreFailed";

  /// <summary>How long a test waits on the real clock for a call that must end by itself: far longer than the service takes.</summary>
  private const int WITHIN_SECONDS = 10;

  /// <summary>Friday's rate, kept over the weekend.</summary>
  private static readonly KorunaRate _fridays = new(24.41m, new DateOnly(2026, 11, 20));

  /// <summary>Monday's rate, the CNB's latest.</summary>
  private static readonly KorunaRate _mondays = new(24.52m, new DateOnly(2026, 11, 23));

  /// <summary>Monday 2026-11-23 at 15:00 UTC, after Monday's 08:00 UTC: a rate kept for Friday would be due.</summary>
  private static readonly DateTimeOffset _mondayAfternoon = new(2026, 11, 23, 15, 0, 0, TimeSpan.Zero);

  /// <summary>Saturday 2026-11-21 at 10:00 UTC, before Monday's 08:00 UTC: a rate kept for Friday is not due.</summary>
  private static readonly DateTimeOffset _saturdayMorning = new(2026, 11, 21, 10, 0, 0, TimeSpan.Zero);

  /// <summary>Monday 2026-11-23 at 09:00 UTC, after Monday's 08:00 UTC: a rate kept for Friday is due.</summary>
  private static readonly DateTimeOffset _mondayMorning = new(2026, 11, 23, 9, 0, 0, TimeSpan.Zero);

  /// <summary>Tuesday 2026-11-24 at 09:00 UTC, after Tuesday's 08:00 UTC: a rate kept for Monday is due.</summary>
  private static readonly DateTimeOffset _tuesdayMorning = new(2026, 11, 24, 9, 0, 0, TimeSpan.Zero);

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

  // When the CNB is asked again (D3, D7)

  /// <summary>
  /// Friday's rate kept, Monday 15:00 UTC, the CNB answering Monday's: the first call answers Monday's and saves it, and
  /// the next call answers it from memory, with no read of the store and no ask. One <c>KorunaRateKept</c> line, at
  /// Information, holding exactly the rate and its day.
  /// </summary>
  [Test]
  public async Task A_rate_for_a_later_day_than_the_kept_one_replaces_it_in_memory_and_in_the_store_and_is_logged_once_as_kept() {
    FakeCnbRates cnb = new(_mondays);
    InMemoryKorunaRateStore store = await StoreKeeping(_fridays);
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_mondayAfternoon), log);

    KorunaRate first = await rates.Current(CancellationToken.None);
    KorunaRate next = await rates.Current(CancellationToken.None);
    int readsByTheService = store.Reads;

    KorunaRate? saved = await store.Read(CancellationToken.None);
    IReadOnlyList<LogEntry> kept = [.. log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_KEPT)];
    first.ShouldSatisfyAllConditions(
      () => first.ShouldBe(_mondays, "the first call's rate, the CNB's for a later day"),
      () => next.ShouldBe(_mondays, "the next call's rate, held in memory"),
      () => cnb.Calls.ShouldBe(1, "the CNB is asked once: the rate for today is not due again on the same day"),
      () => readsByTheService.ShouldBe(1, "the store is read once, on the first call"),
      () => saved.ShouldBe(_mondays, "the rate saved in the store"),
      () => kept.ShouldHaveSingleItem("one KorunaRateKept line").Level.ShouldBe(LogLevel.Information),
      () => kept.ShouldHaveSingleItem("one KorunaRateKept line").OwnValues().ShouldBe([24.52m, new DateOnly(2026, 11, 23)], ignoreOrder: true, "the rate and its day"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 15:00 UTC, the CNB answering Monday's, and a store whose save ends only once the test lets
  /// it (<see cref="SlowSavingStore"/>): the call answers Monday's while the save is still held. The shared ask every caller
  /// awaits ends within the CNB's time limit (D4), never held by a slow store (review of PR #95, finding 4). The wait for the
  /// answer is bounded on the real clock (<see cref="WITHIN_SECONDS"/>), so a call held by the save fails the test rather
  /// than hanging it; the save is let end afterwards, whatever came.
  /// </summary>
  [Test]
  public async Task A_later_days_rate_is_answered_without_waiting_for_its_save() {
    FakeCnbRates cnb = new(_mondays);
    SlowSavingStore store = new(await StoreKeeping(_fridays));
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_mondayAfternoon), new CapturedLog());
    KorunaRate? answered = null;

    try {
      answered = await rates.Current(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));
    }
    catch (TimeoutException) {
      // Still waiting for the held save: the answer below stays null.
    }
    finally {
      store.LetTheSavesEnd();
    }

    answered.ShouldBe(_mondays, "the new rate, answered while its save is still held");
  }

  /// <summary>
  /// Nothing kept on Friday 15:00 UTC, the CNB answering Friday's rate, which is kept: the CNB is not asked again on
  /// Saturday, nor on Monday one tick before 08:00 UTC; at Monday's 08:00 UTC, the next weekday's, it is.
  /// </summary>
  [Test]
  public async Task After_a_rate_for_today_is_kept_the_CNB_is_not_asked_again_before_the_next_weekdays_08_00_UTC() {
    FakeCnbRates cnb = new(_fridays);
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 11, 20, 15, 0, 0, TimeSpan.Zero));
    KorunaRates rates = RatesWith(cnb, new InMemoryKorunaRateStore(), clock, new CapturedLog());
    DateTimeOffset mondayAtEight = new(2026, 11, 23, 8, 0, 0, TimeSpan.Zero);

    _ = await rates.Current(CancellationToken.None);
    int asksOnFriday = cnb.Calls;
    clock.SetUtcNow(_saturdayMorning);
    _ = await rates.Current(CancellationToken.None);
    clock.SetUtcNow(mondayAtEight.AddTicks(-1));
    _ = await rates.Current(CancellationToken.None);
    int asksBeforeMondayAtEight = cnb.Calls;
    clock.SetUtcNow(mondayAtEight);
    _ = await rates.Current(CancellationToken.None);

    cnb.ShouldSatisfyAllConditions(
      () => asksOnFriday.ShouldBe(1, "Friday's ask, with nothing kept"),
      () => asksBeforeMondayAtEight.ShouldBe(1, "no ask on Saturday, nor on Monday one tick before 08:00 UTC"),
      () => cnb.Calls.ShouldBe(2, "an ask at Monday's 08:00 UTC"));
  }

  // Every request asks until a newer day's rate comes (D2, D3, D4, D7)

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB still answering Friday's: each call answers Friday's and asks again,
  /// and nothing is saved and nothing logged (D7: no line for an ask that returns the rate already kept).
  /// </summary>
  [Test]
  public async Task A_rate_for_the_kept_day_changes_nothing_nothing_is_saved_and_nothing_logged_and_the_next_call_asks_again() {
    FakeCnbRates cnb = new(_fridays);
    InMemoryKorunaRateStore store = await StoreKeeping(_fridays);
    int savesBefore = store.Saves;
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_mondayMorning), log);

    KorunaRate first = await rates.Current(CancellationToken.None);
    int asksAfterTheFirstCall = cnb.Calls;
    KorunaRate next = await rates.Current(CancellationToken.None);

    first.ShouldSatisfyAllConditions(
      () => first.ShouldBe(_fridays, "the first call's rate, the kept one"),
      () => next.ShouldBe(_fridays, "the next call's rate, the kept one"),
      () => asksAfterTheFirstCall.ShouldBe(1, "the first call asks"),
      () => cnb.Calls.ShouldBe(2, "the next call asks again: the rate is still due"),
      () => (store.Saves - savesBefore).ShouldBe(0, "nothing saved"),
      () => log.Entries.ShouldBeEmpty("nothing logged"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC: the CNB's answer is held while two callers ask, so the second arrives while the
  /// first one's ask is on its way; both get Monday's rate from one ask (D4).
  /// </summary>
  [Test]
  public async Task Callers_at_the_same_time_share_one_ask() {
    FakeCnbRates cnb = new(_mondays);
    KorunaRates rates = RatesWith(cnb, await StoreKeeping(_fridays), _mondayMorning);
    cnb.HoldTheAnswers();

    Task<KorunaRate> first = rates.Current(CancellationToken.None);
    Task<KorunaRate> second = rates.Current(CancellationToken.None);
    cnb.ReleaseTheAnswers();
    KorunaRate[] answers = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

    answers.ShouldSatisfyAllConditions(
      () => answers.ShouldBe([_mondays, _mondays], "both callers get the CNB's rate"),
      () => cnb.Calls.ShouldBe(1, "one call to the CNB"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB's answer held: the caller that started the ask stops waiting, and its
  /// wait ends at once in a cancellation while the ask is still on its way; the other caller still gets the ask's answer,
  /// with no second ask, and the answer is kept, so the ask ran on though its first caller left (D4: it runs without any
  /// caller's token).
  /// </summary>
  [Test]
  public async Task A_caller_that_stops_waiting_leaves_the_ask_and_its_answer_to_the_other_callers() {
    FakeCnbRates cnb = new(_mondays);
    InMemoryKorunaRateStore store = await StoreKeeping(_fridays);
    KorunaRates rates = RatesWith(cnb, store, _mondayMorning);
    cnb.HoldTheAnswers();
    using CancellationTokenSource leaving = new();

    Task<KorunaRate> left = rates.Current(leaving.Token);
    Task<KorunaRate> staying = rates.Current(CancellationToken.None);
    await leaving.CancelAsync();
    bool leftWithACancellation = await StopsWithACancellation(left.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS)));
    cnb.ReleaseTheAnswers();
    KorunaRate stayingAnswer = await staying.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

    KorunaRate? saved = await store.Read(CancellationToken.None);
    stayingAnswer.ShouldSatisfyAllConditions(
      () => leftWithACancellation.ShouldBeTrue("the leaving caller's wait ends in a cancellation, while the ask is held"),
      () => stayingAnswer.ShouldBe(_mondays, "the other caller gets the ask's answer"),
      () => cnb.Calls.ShouldBe(1, "one call to the CNB: the ask went on"),
      () => saved.ShouldBe(_mondays, "the ask's answer kept"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB still answering Friday's: two callers share one held ask; once it has
  /// ended, a third caller asks anew, now that the CNB answers Monday's, and gets it (D4: the ask is cleared when it ends).
  /// </summary>
  [Test]
  public async Task An_ask_that_has_ended_is_not_shared_the_next_caller_asks_anew_while_the_rate_is_due() {
    FakeCnbRates cnb = new(_fridays);
    KorunaRates rates = RatesWith(cnb, await StoreKeeping(_fridays), _mondayMorning);
    cnb.HoldTheAnswers();
    Task<KorunaRate> first = rates.Current(CancellationToken.None);
    Task<KorunaRate> second = rates.Current(CancellationToken.None);
    cnb.ReleaseTheAnswers();
    _ = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));
    int asksByTheTwo = cnb.Calls;
    cnb.Answers(_mondays);

    KorunaRate third = await rates.Current(CancellationToken.None);

    third.ShouldSatisfyAllConditions(
      () => asksByTheTwo.ShouldBe(1, "the two callers shared one ask"),
      () => cnb.Calls.ShouldBe(2, "the third caller asks anew"),
      () => third.ShouldBe(_mondays, "the new ask's answer"));
  }

  // An earlier day's rate (D2, D6, D7)

  /// <summary>
  /// Monday's rate kept, Tuesday 09:00 UTC, the CNB answering Friday's, as a stale copy in front of it might: the answer is
  /// Monday's, nothing is saved and nothing logged (D6: ignored without a log line).
  /// </summary>
  [Test]
  public async Task A_rate_for_an_earlier_day_than_the_kept_one_is_answered_as_the_kept_one_with_nothing_saved_and_nothing_logged() {
    FakeCnbRates cnb = new(_fridays);
    InMemoryKorunaRateStore store = await StoreKeeping(_mondays);
    int savesBefore = store.Saves;
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_tuesdayMorning), log);

    KorunaRate rate = await rates.Current(CancellationToken.None);

    KorunaRate? kept = await store.Read(CancellationToken.None);
    rate.ShouldSatisfyAllConditions(
      () => cnb.Calls.ShouldBe(1, "the CNB is asked: Monday's rate is due on Tuesday"),
      () => rate.ShouldBe(_mondays, "the kept rate"),
      () => (store.Saves - savesBefore).ShouldBe(0, "nothing saved"),
      () => kept.ShouldBe(_mondays, "the store still keeps Monday's"),
      () => log.Entries.ShouldBeEmpty("nothing logged"));
  }

  // A failed ask, a failing store (D5, D6, D7)

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB's ask failing in each of D6's ways: the kept rate is answered, the CNB is
  /// asked once (no retry), and one <c>KorunaRateAskFailed</c> line at Warning holds the kind, and the status code for a
  /// status (none otherwise).
  /// </summary>
  /// <param name="kind">How the ask failed.</param>
  /// <param name="statusCode">The status code, for <see cref="CnbFailure.Status"/> only.</param>
  [Test]
  [Arguments(CnbFailure.NoAnswerInTime, null)]
  [Arguments(CnbFailure.Unreachable, null)]
  [Arguments(CnbFailure.Status, 500)]
  [Arguments(CnbFailure.Unreadable, null)]
  public async Task A_failed_ask_answers_the_kept_rate_and_logs_its_kind_once_with_the_status_code_for_a_status(CnbFailure kind, int? statusCode) {
    FakeCnbRates cnb = new(new CnbFailed(kind, statusCode));
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, await StoreKeeping(_fridays), new FakeTimeProvider(_mondayMorning), log);

    KorunaRate rate = await rates.Current(CancellationToken.None);

    IReadOnlyList<LogEntry> failed = [.. log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_ASK_FAILED)];
    object?[] expectedValues = statusCode is null ? [kind] : [kind, statusCode];
    rate.ShouldSatisfyAllConditions(
      () => rate.ShouldBe(_fridays, "the kept rate"),
      () => cnb.Calls.ShouldBe(1, "one ask, not retried"),
      () => failed.ShouldHaveSingleItem("one KorunaRateAskFailed line").Level.ShouldBe(LogLevel.Warning),
      () => failed.ShouldHaveSingleItem("one KorunaRateAskFailed line").OwnValues().Where(static value => value is not null)
        .ShouldBe(expectedValues, ignoreOrder: true, "the kind, and the status code for a status"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB's ask failing in a way that has no status code: the one
  /// <c>KorunaRateAskFailed</c> line reads "Asking the CNB for the koruna rate failed: " and the kind, with no status part
  /// (review of PR #95, finding 5: it read "…, status (null)"). The prefix is the one deployment.md's query matches on.
  /// </summary>
  /// <param name="kind">How the ask failed, a kind without a status code.</param>
  [Test]
  [Arguments(CnbFailure.NoAnswerInTime)]
  [Arguments(CnbFailure.Unreachable)]
  [Arguments(CnbFailure.Unreadable)]
  public async Task A_failed_ask_without_a_status_code_logs_its_kind_with_no_status_part(CnbFailure kind) {
    CapturedLog log = new();
    KorunaRates rates = RatesWith(new FakeCnbRates(new CnbFailed(kind)), await StoreKeeping(_fridays), new FakeTimeProvider(_mondayMorning), log);

    _ = await rates.Current(CancellationToken.None);

    log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_ASK_FAILED).ShouldHaveSingleItem("one KorunaRateAskFailed line")
      .Message.ShouldBe($"Asking the CNB for the koruna rate failed: {kind}");
  }

  /// <summary>
  /// Friday's rate kept, Monday 09:00 UTC, the CNB answering status 503: the one <c>KorunaRateAskFailed</c> line reads
  /// "Asking the CNB for the koruna rate failed: Status, status 503" (review of PR #95, finding 5: the status's line keeps
  /// its code).
  /// </summary>
  [Test]
  public async Task A_failed_ask_with_a_status_logs_its_kind_and_its_status_code() {
    CapturedLog log = new();
    KorunaRates rates = RatesWith(new FakeCnbRates(new CnbFailed(CnbFailure.Status, 503)), await StoreKeeping(_fridays), new FakeTimeProvider(_mondayMorning), log);

    _ = await rates.Current(CancellationToken.None);

    log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_ASK_FAILED).ShouldHaveSingleItem("one KorunaRateAskFailed line")
      .Message.ShouldBe("Asking the CNB for the koruna rate failed: Status, status 503");
  }

  /// <summary>
  /// Monday's rate in the store, Tuesday 07:00 UTC, so a kept Monday's rate would not be due; the store's first read fails:
  /// the call goes on as with nothing kept, asks the CNB and answers its rate, and one <c>KorunaRateStoreFailed</c> line at
  /// Warning carries the read's failure. The next call reads the store again, and answers the kept rate without asking.
  /// </summary>
  /// <param name="failure">The read's failure: a row the store cannot read (§ Error model), or the storage's own failure.</param>
  [Test]
  [Arguments("a row it cannot read")]
  [Arguments("the storage's own failure")]
  public async Task A_store_that_fails_to_read_is_treated_as_nothing_kept_logged_and_read_again_by_the_next_call(string failure) {
    FakeCnbRates cnb = new(_mondays);
    UnreliableStore store = new(await StoreKeeping(_mondays), StoreFailure(failure));
    store.FailTheNextRead();
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(new DateTimeOffset(2026, 11, 24, 7, 0, 0, TimeSpan.Zero)), log);

    KorunaRate first = await rates.Current(CancellationToken.None);
    int asksByTheFirstCall = cnb.Calls;
    KorunaRate next = await rates.Current(CancellationToken.None);

    IReadOnlyList<LogEntry> storeFailed = [.. log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_STORE_FAILED)];
    first.ShouldSatisfyAllConditions(
      () => first.ShouldBe(_mondays, "the first call's rate, the CNB's"),
      () => asksByTheFirstCall.ShouldBe(1, "the first call asks the CNB, as with nothing kept"),
      () => storeFailed.ShouldHaveSingleItem("one KorunaRateStoreFailed line").Level.ShouldBe(LogLevel.Warning),
      () => storeFailed.ShouldHaveSingleItem("one KorunaRateStoreFailed line").Exception.ShouldBeSameAs(store.Failure, "the read's failure"),
      () => store.ReadsTried.ShouldBe(2, "the next call reads the store again"),
      () => next.ShouldBe(_mondays, "the next call's rate, the kept one"),
      () => cnb.Calls.ShouldBe(1, "the next call does not ask: Monday's rate is not due before Tuesday's 08:00 UTC"));
  }

  /// <summary>
  /// Friday's rate kept, Monday 15:00 UTC, the CNB answering Monday's, and every save failing: the call still answers
  /// Monday's, holds it, so the next call answers it without asking, and one <c>KorunaRateStoreFailed</c> line at Warning
  /// carries the save's failure. The store keeps Friday's, as it could not be written.
  /// </summary>
  /// <param name="failure">The save's failure: one the store reports itself (§ Error model), or the storage's own failure.</param>
  [Test]
  [Arguments("a row it cannot read")]
  [Arguments("the storage's own failure")]
  public async Task A_store_that_fails_to_save_still_answers_the_new_rate_holds_it_and_logs_it(string failure) {
    FakeCnbRates cnb = new(_mondays);
    InMemoryKorunaRateStore kept = await StoreKeeping(_fridays);
    UnreliableStore store = new(kept, StoreFailure(failure)) { SavesFail = true };
    CapturedLog log = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_mondayAfternoon), log);

    KorunaRate first = await rates.Current(CancellationToken.None);
    KorunaRate next = await rates.Current(CancellationToken.None);

    KorunaRate? inTheStore = await kept.Read(CancellationToken.None);
    IReadOnlyList<LogEntry> storeFailed = [.. log.Entries.Where(static entry => entry.EventName == KORUNA_RATE_STORE_FAILED)];
    first.ShouldSatisfyAllConditions(
      () => first.ShouldBe(_mondays, "the new rate, answered though it could not be saved"),
      () => next.ShouldBe(_mondays, "the new rate, held in memory"),
      () => cnb.Calls.ShouldBe(1, "the next call does not ask: the held rate is for today"),
      () => store.SavesTried.ShouldBe(1, "one save tried"),
      () => inTheStore.ShouldBe(_fridays, "the store keeps what it kept"),
      () => storeFailed.ShouldHaveSingleItem("one KorunaRateStoreFailed line").Level.ShouldBe(LogLevel.Warning),
      () => storeFailed.ShouldHaveSingleItem("one KorunaRateStoreFailed line").Exception.ShouldBeSameAs(store.Failure, "the save's failure"));
  }

  /// <summary>
  /// Tuesday's rate in the store, Tuesday 15:00 UTC, the store's first read failing, and the CNB answering Monday's, as a
  /// stale copy in front of it might (D6): the call asks the CNB, as with nothing kept, but the store keeps Tuesday's, since
  /// only a later day's rate replaces the kept one (D2; spec koruna-rate); and the next call answers Tuesday's (review of
  /// PR #95, finding 3).
  /// </summary>
  [Test]
  public async Task After_a_failed_read_a_rate_for_an_earlier_day_than_the_stores_does_not_replace_it() {
    KorunaRate tuesdays = new(24.55m, new DateOnly(2026, 11, 24));
    InMemoryKorunaRateStore kept = await StoreKeeping(tuesdays);
    UnreliableStore store = new(kept, StoreFailure("the storage's own failure"));
    store.FailTheNextRead();
    KorunaRates rates = RatesWith(new FakeCnbRates(_mondays), store, new FakeTimeProvider(new DateTimeOffset(2026, 11, 24, 15, 0, 0, TimeSpan.Zero)), new CapturedLog());

    _ = await rates.Current(CancellationToken.None);
    KorunaRate? inTheStore = await kept.Read(CancellationToken.None);
    KorunaRate next = await rates.Current(CancellationToken.None);

    inTheStore.ShouldSatisfyAllConditions(
      () => inTheStore.ShouldBe(tuesdays, "the store keeps Tuesday's: Monday's is for an earlier day"),
      () => next.ShouldBe(tuesdays, "the next call's rate, the store's later one"));
  }

  /// <summary>
  /// Nothing in the store, Monday 15:00 UTC, the store's first read failing, and the CNB answering Monday's: the store keeps
  /// Monday's after the call. A failed read stops no save of a rate the store has nothing later than (review of PR #95,
  /// finding 3).
  /// </summary>
  [Test]
  public async Task After_a_failed_read_a_rate_the_CNB_answers_is_saved_when_the_store_holds_none() {
    InMemoryKorunaRateStore kept = new();
    UnreliableStore store = new(kept, StoreFailure("the storage's own failure"));
    store.FailTheNextRead();
    KorunaRates rates = RatesWith(new FakeCnbRates(_mondays), store, new FakeTimeProvider(_mondayAfternoon), new CapturedLog());

    _ = await rates.Current(CancellationToken.None);

    (await kept.Read(CancellationToken.None)).ShouldBe(_mondays, "the CNB's rate, saved");
  }

  // Nothing kept (D5)

  /// <summary>
  /// Nothing kept, Monday 09:00 UTC, the CNB answering a server error: the app's own rate is answered, nothing is saved,
  /// and the next call asks again, and again gets the app's own rate.
  /// </summary>
  [Test]
  public async Task With_nothing_kept_and_a_failed_ask_the_apps_own_rate_is_answered_and_not_saved_and_the_next_call_asks_again() {
    FakeCnbRates cnb = new(new CnbFailed(CnbFailure.Status, 503));
    InMemoryKorunaRateStore store = new();
    KorunaRates rates = RatesWith(cnb, store, new FakeTimeProvider(_mondayMorning), new CapturedLog());

    KorunaRate first = await rates.Current(CancellationToken.None);
    int asksByTheFirstCall = cnb.Calls;
    KorunaRate next = await rates.Current(CancellationToken.None);

    KorunaRate? kept = await store.Read(CancellationToken.None);
    first.ShouldSatisfyAllConditions(
      () => first.ShouldBe(KorunaRate.AppsOwn, "the app's own rate"),
      () => store.Saves.ShouldBe(0, "nothing saved"),
      () => kept.ShouldBeNull("nothing kept in the store"),
      () => asksByTheFirstCall.ShouldBe(1, "the first call asks"),
      () => cnb.Calls.ShouldBe(2, "the next call asks again"),
      () => next.ShouldBe(KorunaRate.AppsOwn, "the next call's rate, the app's own again"));
  }

  /// <summary>
  /// The failure a store throws in a test: a row it cannot read, as the Table adapter reports one (§ Error model:
  /// an <see cref="InvalidOperationException"/> naming the column); or the storage's own failure, as the Azure SDK reports
  /// one (made up: the service unavailable).
  /// </summary>
  private static Exception StoreFailure(string failure) => failure switch {
    "a row it cannot read" => new InvalidOperationException("A made-up row of the kept koruna rate's table that cannot be read: its CzkPerEur column is missing."),
    "the storage's own failure" => new RequestFailedException(503, "A made-up storage failure: the table service is unavailable."),
    _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
  };

  /// <summary>
  /// Whether <paramref name="wait"/> ends in an <see cref="OperationCanceledException"/> (or one derived from it, as
  /// <see cref="TaskCanceledException"/>); any other ending is <see langword="false"/>, and a <see cref="TimeoutException"/>
  /// from a bounded wait passes on.
  /// </summary>
  private static async Task<bool> StopsWithACancellation(Task wait) {
    try {
      await wait;

      return false;
    }
    catch (OperationCanceledException) {
      return true;
    }
  }

  /// <summary>The service under test, asking <paramref name="cnb"/>, keeping its rate in <paramref name="store"/>, with the clock at <paramref name="now"/>.</summary>
  private static KorunaRates RatesWith(FakeCnbRates cnb, InMemoryKorunaRateStore store, DateTimeOffset now) =>
    new(cnb, store, new FakeTimeProvider(now), NullLogger<KorunaRates>.Instance);

  /// <summary>The service under test, asking <paramref name="cnb"/>, keeping its rate in <paramref name="store"/>, on <paramref name="clock"/>, logging to <paramref name="log"/>.</summary>
  private static KorunaRates RatesWith(FakeCnbRates cnb, IKorunaRateStore store, FakeTimeProvider clock, CapturedLog log) =>
    new(cnb, store, clock, log);

  /// <summary>A store keeping <paramref name="rate"/>, saved before the service exists, so no read is counted yet.</summary>
  private static async Task<InMemoryKorunaRateStore> StoreKeeping(KorunaRate rate) {
    InMemoryKorunaRateStore store = new();
    await store.Save(rate, CancellationToken.None);

    return store;
  }

  /// <summary>The service's logger, keeping every line it writes: its level, its event's name, its structured values, its exception and its message.</summary>
  private sealed class CapturedLog : ILogger<KorunaRates> {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>Every line, in the order written.</summary>
    public IReadOnlyList<LogEntry> Entries {
      get {
        lock (_lock)
          return [.. _entries];
      }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
      ArgumentNullException.ThrowIfNull(formatter);

      LogEntry entry = new(logLevel, eventId.Name, [.. values], exception, formatter(state, exception));

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>
  /// The kept rate's store, failing as the test says, in front of the in-memory one, which keeps what it is given otherwise:
  /// the next read fails (<see cref="FailTheNextRead"/>), or every save (<see cref="SavesFail"/>), with
  /// <see cref="Failure"/>, as a faulted task, as the Table adapter's calls fail. Every read and save tried is counted,
  /// failed or not. Kept apart from <see cref="InMemoryKorunaRateStore"/>, which the contract tests check as a store that
  /// works.
  /// </summary>
  private sealed class UnreliableStore(InMemoryKorunaRateStore kept, Exception failure) : IKorunaRateStore {
    private readonly Lock _lock = new();
    private int _readsToFail;
    private int _readsTried;
    private int _savesTried;

    /// <summary>What a failing read or save throws.</summary>
    public Exception Failure => failure;

    /// <summary>Whether every save fails; none does at first.</summary>
    public bool SavesFail { get; init; }

    /// <summary>How many reads were tried so far, failed or not.</summary>
    public int ReadsTried {
      get {
        lock (_lock)
          return _readsTried;
      }
    }

    /// <summary>How many saves were tried so far, failed or not.</summary>
    public int SavesTried {
      get {
        lock (_lock)
          return _savesTried;
      }
    }

    /// <summary>The next read fails; later ones read the in-memory store.</summary>
    public void FailTheNextRead() {
      lock (_lock)
        _readsToFail++;
    }

    public Task<KorunaRate?> Read(CancellationToken cancellationToken) {
      lock (_lock) {
        _readsTried++;

        if (_readsToFail > 0) {
          _readsToFail--;

          return Task.FromException<KorunaRate?>(failure);
        }
      }

      return kept.Read(cancellationToken);
    }

    public Task Save(KorunaRate rate, CancellationToken cancellationToken) {
      lock (_lock)
        _savesTried++;

      return SavesFail ? Task.FromException(failure) : kept.Save(rate, cancellationToken);
    }
  }

  /// <summary>
  /// The kept rate's store, saving slowly, in front of the in-memory one: every save waits until the test lets the saves
  /// end (<see cref="LetTheSavesEnd"/>), then saves into the in-memory store; reads answer at once. Kept apart from
  /// <see cref="InMemoryKorunaRateStore"/>, which the contract tests check as a store that answers at once.
  /// </summary>
  private sealed class SlowSavingStore(InMemoryKorunaRateStore kept) : IKorunaRateStore {
    private readonly TaskCompletionSource _savesMayEnd = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Every save waiting, and every later one, goes on to the in-memory store.</summary>
    public void LetTheSavesEnd() => _savesMayEnd.TrySetResult();

    public Task<KorunaRate?> Read(CancellationToken cancellationToken) => kept.Read(cancellationToken);

    public async Task Save(KorunaRate rate, CancellationToken cancellationToken) {
      await _savesMayEnd.Task.WaitAsync(cancellationToken);
      await kept.Save(rate, cancellationToken);
    }
  }

  /// <summary>One line of the service's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values, Exception? Exception, string Message) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>The values of the line's own fields, without its message template.</summary>
    public IReadOnlyList<object?> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => pair.Value)];

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}