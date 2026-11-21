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
/// is not shared once it has ended; an earlier day's rate is answered as the kept one. A wait that must end by itself is
/// bounded on the real clock (<see cref="WITHIN_SECONDS"/>), never a pause. The CNB is a hand-written fake of the port
/// (<see cref="FakeCnbRates"/>), the kept rate an in-memory store (<see cref="InMemoryKorunaRateStore"/>), the clock a
/// <see cref="FakeTimeProvider"/>, the log a hand-written logger (<see cref="CapturedLog"/>). The rates and days are the
/// spec's: Friday 2026-11-20's and Monday 2026-11-23's.
/// </summary>
public sealed class KorunaRatesTests {
  /// <summary>The event of the line a newly kept rate writes (D7).</summary>
  private const string KORUNA_RATE_KEPT = "KorunaRateKept";

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
  private static KorunaRates RatesWith(FakeCnbRates cnb, InMemoryKorunaRateStore store, FakeTimeProvider clock, CapturedLog log) =>
    new(cnb, store, clock, log);

  /// <summary>A store keeping <paramref name="rate"/>, saved before the service exists, so no read is counted yet.</summary>
  private static async Task<InMemoryKorunaRateStore> StoreKeeping(KorunaRate rate) {
    InMemoryKorunaRateStore store = new();
    await store.Save(rate, CancellationToken.None);

    return store;
  }

  /// <summary>The service's logger, keeping every line it writes: its level, its event's name and its structured values.</summary>
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
      LogEntry entry = new(logLevel, eventId.Name, [.. values]);

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>One line of the service's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values) {
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