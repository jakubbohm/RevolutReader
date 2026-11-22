using System.ComponentModel.DataAnnotations;

namespace RevolutReader.Api.Configuration;

/// <summary>
/// A <see cref="TimeSpan"/> setting's range, both limits included, as <c>[TimeSpanRange("00:00:01", "00:02:00")]</c> (#68).
/// It stands in for <c>[Range(typeof(TimeSpan), …)]</c>, whose attribute converts its text limits on first use without a
/// lock (dotnet/runtime#110917), so app copies starting at the same time could fail at random: this one reads both limits
/// once, in its constructor, and refuses limits that are not a time or a minimum above the maximum there. A value outside
/// the range fails with a message naming the setting and both limits, never the value; a missing value passes, as with
/// <c>[Range]</c>, and is <see cref="RequiredAttribute"/>'s to refuse. It checks the value alone, so the failure names the
/// member it validates.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field)]
public sealed class TimeSpanRangeAttribute : ValidationAttribute {
  /// <param name="minimum">The shortest time allowed, as a TimeSpan setting reads (<c>"00:00:01"</c>).</param>
  /// <param name="maximum">The longest time allowed, written the same way.</param>
  public TimeSpanRangeAttribute(string minimum, string maximum) => throw new NotImplementedException();

  /// <summary>The shortest time allowed, as written in the attribute.</summary>
  public string Minimum { get; }

  /// <summary>The longest time allowed, as written in the attribute.</summary>
  public string Maximum { get; }

  public override bool IsValid(object? value) => throw new NotImplementedException();

  public override string FormatErrorMessage(string name) => throw new NotImplementedException();
}