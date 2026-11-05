using System.Reflection;

namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// Reads the claims on scenarios (c001 design.md D7): <see cref="ScenarioAttribute"/> on test methods, and the rows of
/// <c>tests/manual-scenarios.md</c>. C3 adds the frontend tests' <c>scenario(...)</c> literals.
/// </summary>
public static class ClaimDiscovery {
  public static IReadOnlyList<ScenarioClaim> FromAttributes(Assembly assembly) {
    ArgumentNullException.ThrowIfNull(assembly);

    return [.. assembly.GetTypes()
      .SelectMany(static type => type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly))
      .SelectMany(static method => method.GetCustomAttributes<ScenarioAttribute>()
        .Select(attribute => new ScenarioClaim(attribute.Capability, attribute.Name, $"{method.DeclaringType?.FullName}.{method.Name}")))];
  }

  /// <summary>
  /// One claim per data row of the Markdown table (columns: capability, scenario, why manual, handover step, date last
  /// checked); the header row and the separator row are not claims. <paramref name="source"/> names the file in the
  /// problem report, with the row's line number.
  /// </summary>
  public static IReadOnlyList<ScenarioClaim> FromManualList(string markdown, string source) {
    ArgumentNullException.ThrowIfNull(markdown);

    List<ScenarioClaim> claims = [];
    bool belowSeparator = false;
    string[] lines = markdown.ReplaceLineEndings("\n").Split('\n');

    for (int index = 0; index < lines.Length; index++) {
      string line = lines[index].Trim();
      if (line is not ['|', ..]) {
        belowSeparator = false;
        continue;
      }

      string[] cells = line.Trim('|').Split('|', StringSplitOptions.TrimEntries);
      if (cells.All(IsSeparatorCell))
        belowSeparator = true;
      else if (belowSeparator)
        claims.Add(new(cells[0], cells.Length > 1 ? cells[1] : string.Empty, $"{source} line {index + 1}"));
    }

    return claims;
  }

  private static bool IsSeparatorCell(string cell) => cell.Trim(':') is { Length: > 0 } dashes && dashes.All(static character => character == '-');
}