using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;
using Shouldly;

namespace RevolutReader.UnitTests.Configuration;

/// <summary>
/// A TimeSpan setting's range (#97, the owner's decision of 2026-11-22): both limits are allowed and a value one tick
/// outside fails; a missing value passes, as with <c>[Range]</c>, since refusing it is <see cref="RequiredAttribute"/>'s;
/// a failure names the member it validates, as its only member, and both limits in its message, never the value. It
/// stands in for <c>[Range(typeof(TimeSpan), …)]</c>, whose attribute converts its text limits on first use without a lock
/// (dotnet/runtime#110917), so one new attribute is also validated from many threads at once. Limits that are not a time,
/// or a minimum above the maximum, are refused by the constructor, so a wrong attribute stops the app at its first check.
/// Each value is validated as the standard check validates a setting: alone, with the member's name in the context.
/// </summary>
public sealed class TimeSpanRangeAttributeTests {
  /// <summary>A range as the settings write one: the Enable Banking request timeout's (c008 design.md D1).</summary>
  private const string MINIMUM = "00:00:01";
  private const string MAXIMUM = "00:02:00";

  /// <summary>The member validated, as the standard check names it.</summary>
  private const string MEMBER = "RequestTimeout";

  /// <summary>How many threads validate at the same moment, and how many new attributes, one a round.</summary>
  private const int THREADS = 8;
  private const int ROUNDS = 1000;

  private static readonly TimeSpan _minimum = TimeSpan.FromSeconds(1);
  private static readonly TimeSpan _maximum = TimeSpan.FromMinutes(2);

  /// <summary>The longest a thread waits for the others at the start of a round; only a broken test ever waits that long.</summary>
  private static readonly TimeSpan _waitAtMost = TimeSpan.FromSeconds(10);

  /// <summary>Values with the right answer for <see cref="MINIMUM"/> to <see cref="MAXIMUM"/>: the limits, between, one tick outside each, missing.</summary>
  private static readonly (TimeSpan? Value, bool Passes)[] _answers = [
    (_minimum, true),
    (TimeSpan.FromSeconds(30), true),
    (_maximum, true),
    (_minimum - TimeSpan.FromTicks(1), false),
    (_maximum + TimeSpan.FromTicks(1), false),
    (null, true),
  ];

  /// <summary>The settings object a validated value belongs to; the attribute checks the value alone.</summary>
  private static readonly object _settings = new();

  /// <param name="value">A value the range allows: either limit, or a time between them.</param>
  [Test]
  [Arguments("the minimum")]
  [Arguments("between the limits")]
  [Arguments("the maximum")]
  public void A_value_at_either_limit_or_between_them_passes(string value) {
    TimeSpan time = value switch {
      "the minimum" => _minimum,
      "between the limits" => TimeSpan.FromSeconds(30),
      "the maximum" => _maximum,
      _ => throw new ArgumentOutOfRangeException(nameof(value), value, "Not a known case."),
    };

    Validate(new TimeSpanRangeAttribute(MINIMUM, MAXIMUM), time).ShouldBe(ValidationResult.Success);
  }

  /// <param name="value">A value just outside the range: one tick below the minimum, or one tick above the maximum.</param>
  [Test]
  [Arguments("one tick below the minimum")]
  [Arguments("one tick above the maximum")]
  public void A_value_one_tick_outside_the_limits_fails(string value) {
    TimeSpan time = value switch {
      "one tick below the minimum" => _minimum - TimeSpan.FromTicks(1),
      "one tick above the maximum" => _maximum + TimeSpan.FromTicks(1),
      _ => throw new ArgumentOutOfRangeException(nameof(value), value, "Not a known case."),
    };

    Validate(new TimeSpanRangeAttribute(MINIMUM, MAXIMUM), time).ShouldNotBe(ValidationResult.Success);
  }

  [Test]
  public void A_missing_value_passes_leaving_it_to_Required() =>
    Validate(new TimeSpanRangeAttribute(MINIMUM, MAXIMUM), value: null).ShouldBe(ValidationResult.Success);

  [Test]
  public void A_failure_names_the_member_as_its_only_member_and_both_limits_in_its_message_never_the_value() {
    const string value = "00:05:00";

    ValidationResult? failure = Validate(new TimeSpanRangeAttribute(MINIMUM, MAXIMUM), TimeSpan.FromMinutes(5));

    failure.ShouldNotBeNull("a value outside the range fails");
    string message = failure.ErrorMessage.ShouldNotBeNull("a failure says what is wrong");
    failure.ShouldSatisfyAllConditions(
      () => failure.MemberNames.ShouldBe([MEMBER]),
      () => message.ShouldContain(MEMBER, Case.Sensitive),
      () => message.ShouldContain(MINIMUM, Case.Sensitive),
      () => message.ShouldContain(MAXIMUM, Case.Sensitive),
      () => message.ShouldNotContain(value, Case.Sensitive, "no failure message may contain the setting's value"));
  }

  /// <summary>
  /// Why this test exists: the attribute this one replaces, <c>RangeAttribute(Type, string, string)</c>, converts its text
  /// limits on first use without a lock (dotnet/runtime#110917), so app copies starting at the same time failed their
  /// settings check at random, an <see cref="InvalidCastException"/> or a wrong answer (#97). Here every round gives
  /// <see cref="THREADS"/> threads an attribute nobody has used yet and releases them onto it at the same moment; every
  /// answer must be the right one, and none may throw. A thousand rounds take a fraction of a second.
  /// </summary>
  [Test]
  public async Task Many_threads_validating_one_new_attribute_at_the_same_moment_never_throw_and_always_answer_right() {
    ValidationAttribute[] ranges = [.. Enumerable.Range(0, ROUNDS).Select(static _ => new TimeSpanRangeAttribute(MINIMUM, MAXIMUM))];
    using Barrier together = new(THREADS);

    // Threads of their own, not the pool's: a pool slow to add threads would hold back the release.
    IReadOnlyList<string>[] wrongAnswers = await Task.WhenAll(Enumerable.Range(0, THREADS).Select(thread => Task.Factory.StartNew(
      () => WrongAnswers(thread, ranges, together), CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default)));

    string[] wrong = [.. wrongAnswers.SelectMany(static answers => answers)];
    wrong.Length.ShouldBe(0, $"wrong answers or exceptions among {THREADS * ROUNDS * _answers.Length} validations; the first: {string.Join(" | ", wrong.Take(10))}");
  }

  /// <param name="limit">Which limit is not a time; the other is a valid one.</param>
  [Test]
  [Arguments("minimum")]
  [Arguments("maximum")]
  public void A_limit_that_is_not_a_time_is_refused_by_the_constructor_naming_that_limit(string limit) {
    (string Minimum, string Maximum) limits = limit switch {
      "minimum" => ("one second", MAXIMUM),
      "maximum" => (MINIMUM, "two minutes"),
      _ => throw new ArgumentOutOfRangeException(nameof(limit), limit, "Not a known case."),
    };

    Should.Throw<ArgumentException>(() => new TimeSpanRangeAttribute(limits.Minimum, limits.Maximum)).ParamName.ShouldBe(limit);
  }

  [Test]
  public void A_minimum_above_the_maximum_is_refused_by_the_constructor() =>
    Should.Throw<ArgumentException>(() => new TimeSpanRangeAttribute(MAXIMUM, MINIMUM));

  /// <summary>
  /// The result of <paramref name="range"/> on <paramref name="value"/>, as the standard check validates a setting: the
  /// value alone, with the member's name, <see cref="MEMBER"/>, as the context's member and display name.
  /// </summary>
  private static ValidationResult? Validate(ValidationAttribute range, TimeSpan? value) =>
    range.GetValidationResult(value, new ValidationContext(_settings, MEMBER, null, null) { MemberName = MEMBER, DisplayName = MEMBER });

  /// <summary>
  /// What <paramref name="thread"/> got wrong over every round: at the start of each, it waits for the other threads, then
  /// validates every value of <see cref="_answers"/> with that round's attribute, starting at a value of its own, so the
  /// threads' first calls differ. An exception counts as a wrong answer, so the thread goes on to the next round.
  /// </summary>
  private static List<string> WrongAnswers(int thread, ValidationAttribute[] ranges, Barrier together) {
    List<string> wrong = [];

    for (int round = 0; round < ranges.Length; round++) {
      if (!together.SignalAndWait(_waitAtMost))
        throw new TimeoutException($"Thread {thread} waited {_waitAtMost} for the others at round {round}.");

      for (int next = 0; next < _answers.Length; next++) {
        (TimeSpan? value, bool passes) = _answers[(thread + next) % _answers.Length];

#pragma warning disable CA1031 // Any exception is the race this test is for; it is counted, so the thread still meets the others in every round.
        try {
          bool passed = Validate(ranges[round], value) == ValidationResult.Success;

          if (passed != passes)
            wrong.Add($"round {round}: {value?.ToString() ?? "no value"} {(passed ? "passed" : "failed")}");
        }
        catch (Exception exception) {
          wrong.Add($"round {round}: {value?.ToString() ?? "no value"} threw {exception.GetType().Name}: {exception.Message}");
        }
#pragma warning restore CA1031
      }
    }

    return wrong;
  }
}