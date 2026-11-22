using Shouldly;

namespace RevolutReader.UnitTests.Configuration;

/// <summary>
/// The failure of a settings class's own rules, its data annotations, as the standard check writes it (the owner's
/// decision on #97, 2026-11-22; configuration.md § Binding): <c>DataAnnotation validation failed for 'AccountCheckOptions'
/// members: 'Key' with the error: 'The Key field is required.'.</c> It names the setting by its settings class and its
/// member, each in quotes, then says what is wrong. The settings tests check a rule's failure with it; a hand-written
/// check's failure opens with the setting's full name instead (<c>AccountCheck:Key is …</c>) and is checked by each test.
/// </summary>
public static class DataAnnotationFailures {
  /// <summary>
  /// Asserts that <paramref name="failures"/> hold the standard data-annotation failure of <typeparamref name="TOptions"/>'s
  /// <paramref name="member"/>, naming that member alone, that says each of <paramref name="says"/> (case aside).
  /// </summary>
  /// <param name="failures">The failure messages of the start-up checks.</param>
  /// <param name="member">The setting, as the settings class names it (<c>nameof(AccountCheckOptions.Key)</c>).</param>
  /// <param name="says">What the failure says besides the names: <c>required</c>, <c>placeholder</c>, a range's limits.</param>
  public static void ShouldHaveDataAnnotationFailure<TOptions>(this IEnumerable<string> failures, string member, params string[] says)
    where TOptions : class {
    ArgumentNullException.ThrowIfNull(failures);
    ArgumentException.ThrowIfNullOrWhiteSpace(member);
    ArgumentNullException.ThrowIfNull(says);

    string[] messages = [.. failures];
    string settingsClass = $"'{typeof(TOptions).Name}'";
    string members = $"members: '{member}'";

    messages.ShouldContain(
      failure => failure.Contains(settingsClass, StringComparison.Ordinal)
        && failure.Contains(members, StringComparison.Ordinal)
        && says.All(said => failure.Contains(said, StringComparison.OrdinalIgnoreCase)),
      $"a data-annotation failure naming {settingsClass} and {members} that says {string.Join(" and ", says)}; the failures were: {string.Join(" | ", messages)}");
  }
}