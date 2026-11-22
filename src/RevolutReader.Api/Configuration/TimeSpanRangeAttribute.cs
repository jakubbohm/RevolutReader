using System.ComponentModel.DataAnnotations;
using System.Globalization;

namespace RevolutReader.Api.Configuration;

/// <summary>
/// A <see cref="TimeSpan"/> setting's range, both limits included, as <c>[TimeSpanRange("00:00:01", "00:02:00")]</c> (#68).
/// It stands in for <c>[Range(typeof(TimeSpan), …)]</c>, whose attribute converts its text limits on first use without a
/// lock (dotnet/runtime#110917), so app copies starting at the same time could fail at random: this one reads both limits
/// once, in its constructor, and refuses limits that are not a time or a minimum above the maximum there. A value outside
/// the range fails with a message naming the setting and both limits, never the value; a missing value passes, as with
/// <c>[Range]</c>, and is <see cref="RequiredAttribute"/>'s to refuse. It checks the value alone, so the failure names the
/// member it validates. Nothing of its own changes after the constructor, so one instance may be checked from many threads
/// at once. It goes once the fix ships in the .NET the app runs on: each use goes back to <c>[Range(typeof(TimeSpan), …)]</c>
/// and that constructor's line leaves BannedSymbols.txt.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field)]
public sealed class TimeSpanRangeAttribute : ValidationAttribute {
  /// <summary>
  /// The default failure, worded as <c>[Range]</c>'s: <c>{0}</c> is the setting's name, <c>{1}</c> and <c>{2}</c> the
  /// limits as written.
  /// </summary>
  private const string OUTSIDE_THE_RANGE = "The field {0} must be between {1} and {2}.";

  private readonly TimeSpan _minimum;
  private readonly TimeSpan _maximum;

  /// <param name="minimum">The shortest time allowed, as a TimeSpan setting reads (<c>"00:00:01"</c>).</param>
  /// <param name="maximum">The longest time allowed, written the same way.</param>
  /// <exception cref="ArgumentException">A limit is not a time, or the minimum is above the maximum.</exception>
  public TimeSpanRangeAttribute(string minimum, string maximum) : base(OUTSIDE_THE_RANGE) {
    _minimum = Limit(minimum, nameof(minimum));
    _maximum = Limit(maximum, nameof(maximum));

    if (_minimum > _maximum)
      throw new ArgumentException($"The minimum \"{minimum}\" is above the maximum \"{maximum}\".", nameof(minimum));

    Minimum = minimum;
    Maximum = maximum;
  }

  /// <summary>The shortest time allowed, as written in the attribute.</summary>
  public string Minimum { get; }

  /// <summary>The longest time allowed, as written in the attribute.</summary>
  public string Maximum { get; }

  /// <summary>Whether <paramref name="value"/> lies within both limits, each included; a missing value passes.</summary>
  /// <exception cref="InvalidOperationException">The value is not a <see cref="TimeSpan"/>: the attribute sits on a member of another type.</exception>
  public override bool IsValid(object? value) => value switch {
    null => true,
    TimeSpan time => time >= _minimum && time <= _maximum,
    { } other => throw new InvalidOperationException($"[TimeSpanRange] checks a TimeSpan setting, not a {other.GetType().Name}."),
  };

  /// <summary>The failure for the setting <paramref name="name"/>, with both limits as written; never the value.</summary>
  public override string FormatErrorMessage(string name) => string.Format(CultureInfo.CurrentCulture, ErrorMessageString, name, Minimum, Maximum);

  /// <summary>
  /// <paramref name="limit"/> read as a TimeSpan setting reads, in the invariant culture; a limit that is not a time is
  /// refused, naming the constructor's parameter <paramref name="name"/>.
  /// </summary>
  private static TimeSpan Limit(string limit, string name) =>
    TimeSpan.TryParse(limit, CultureInfo.InvariantCulture, out TimeSpan time)
      ? time
      : throw new ArgumentException($"The {name} \"{limit}\" is not a time, such as \"00:00:01\".", name);
}