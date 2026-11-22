using System.Globalization;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The time limit of one ask (<see cref="CnbOptions.TimeLimit"/>, c017 design.md D4, D6, § Error model): an answer later
/// than it is <see cref="CnbFailure.NoAnswerInTime"/>. The caller's own cancellation is no failure of the CNB: it passes on
/// as an <see cref="OperationCanceledException"/>, never as a result. The limits are short, so no test waits longer than it
/// must; the answer, a usable one, would come long after.
/// </summary>
public sealed class TimeLimitTests {
  /// <summary>A usable answer: the euro's entry as the CNB wrote it on 2026-11-21 (design.md § Context).</summary>
  private const string DAILY_RATES = """{"rates":[{"validFor":"2026-11-20","order":223,"country":"EMU","currency":"euro","amount":1,"currencyCode":"EUR","rate":24.47}]}""";

  /// <summary>The limit is 0.2 s; the answer would come after 3 s.</summary>
  [Test]
  public async Task An_answer_later_than_the_time_limit_is_NoAnswerInTime() {
    using CnbOnWireMock cnb = new(LimitOf(TimeSpan.FromMilliseconds(200)));
    cnb.AnswersTheDailyRates(DAILY_RATES, after: TimeSpan.FromSeconds(3));

    CnbAnswer answer = await cnb.Cnb.ReadEuroRate(CancellationToken.None);

    answer.Value.ShouldBe(new CnbFailed(CnbFailure.NoAnswerInTime));
  }

  /// <summary>The caller gives up after 0.2 s, well before the limit (5 s) and the answer (after 10 s).</summary>
  [Test]
  public async Task The_callers_own_cancellation_passes_on() {
    using CnbOnWireMock cnb = new(LimitOf(TimeSpan.FromSeconds(5)));
    cnb.AnswersTheDailyRates(DAILY_RATES, after: TimeSpan.FromSeconds(10));
    using CancellationTokenSource caller = new(TimeSpan.FromMilliseconds(200));

    await Should.ThrowAsync<OperationCanceledException>(() => cnb.Cnb.ReadEuroRate(caller.Token));
  }

  /// <summary>The <c>Cnb:TimeLimit</c> setting at <paramref name="limit"/>.</summary>
  private static Dictionary<string, string?> LimitOf(TimeSpan limit) =>
    new() { ["Cnb:TimeLimit"] = limit.ToString("c", CultureInfo.InvariantCulture) };
}