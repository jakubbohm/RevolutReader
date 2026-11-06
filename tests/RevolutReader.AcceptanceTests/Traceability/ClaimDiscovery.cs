using System.Reflection;
using System.Text.RegularExpressions;

namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// Reads the claims on scenarios (c001 design.md D7, c003 design.md D7): <see cref="ScenarioAttribute"/> on test
/// methods, the rows of <c>tests/manual-scenarios.md</c>, and the <c>scenario(...)</c> calls of the frontend's tests.
/// </summary>
public static partial class ClaimDiscovery {
  /// <summary>A JavaScript string literal in single or double quotes on one line; the only escapes read are <c>\'</c>, <c>\"</c> and <c>\\</c>.</summary>
  private const string STRING_LITERAL = @"'(?:[^'\\\n]|\\['""\\])*'|""(?:[^""\\\n]|\\['""\\])*""";

  private static readonly string[] _frontendTestEndings = [".test.ts", ".test.tsx"];

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

  /// <summary>
  /// The claims of one frontend test file (c003 design.md D7): every <c>scenario(</c> call whose first two arguments,
  /// the capability and the name, are string literals in single or double quotes, with whitespace and line breaks
  /// allowed around them. Every other <c>scenario(</c> call is unreadable (a template literal, a variable, a missing
  /// name, an expression, an escape other than <c>\'</c>, <c>\"</c> and <c>\\</c>), so a claim can never vanish
  /// silently. <paramref name="source"/> is the file's repository-relative path; each claim and each unreadable call
  /// names it with the line its <c>scenario(</c> starts on.
  /// </summary>
  public static FrontendClaims FromFrontendTest(string text, string source) {
    ArgumentNullException.ThrowIfNull(text);

    string normalized = text.ReplaceLineEndings("\n");
    List<ScenarioClaim> claims = [];
    List<string> unreadable = [];

    foreach (Match call in ScenarioCall().Matches(normalized)) {
      string location = $"{source} line {LineOf(normalized, call.Index)}";
      Match arguments = LiteralArguments().Match(normalized, call.Index + call.Length);

      if (arguments.Success)
        claims.Add(new(Unquote(arguments.Groups["capability"].Value), Unquote(arguments.Groups["name"].Value), location));
      else
        unreadable.Add(location);
    }

    return new(claims, unreadable);
  }

  /// <summary>
  /// The frontend's test files, <c>src/RevolutReader.Web/src/**/*.test.ts</c> and <c>*.test.tsx</c>, as
  /// repository-relative paths with forward slashes, in ordinal order. <c>node_modules</c> sits outside that folder, so
  /// it is never read. A missing folder means no files.
  /// </summary>
  public static IReadOnlyList<string> FrontendTestFiles(string repositoryRoot) {
    ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);

    string folder = Path.Combine(repositoryRoot, "src", "RevolutReader.Web", "src");
    if (!Directory.Exists(folder))
      return [];

    return [.. Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
      .Where(static file => _frontendTestEndings.Any(ending => file.EndsWith(ending, StringComparison.Ordinal)))
      .Select(file => Path.GetRelativePath(repositoryRoot, file).Replace(Path.DirectorySeparatorChar, '/'))
      .Order(StringComparer.Ordinal)];
  }

  private static bool IsSeparatorCell(string cell) => cell.Trim(':') is { Length: > 0 } dashes && dashes.All(static character => character == '-');

  private static int LineOf(string text, int index) => text.AsSpan(0, index).Count('\n') + 1;

  /// <summary>The literal's text without its quotes, with <c>\'</c>, <c>\"</c> and <c>\\</c> read as the character they escape.</summary>
  private static string Unquote(string literal) => EscapedCharacter().Replace(literal[1..^1], "$1");

  /// <summary>The start of a call to the helper: <c>scenario</c> as a whole identifier, then <c>(</c>.</summary>
  [GeneratedRegex(@"(?<![\w$])scenario\s*\(")]
  private static partial Regex ScenarioCall();

  /// <summary>Two string literals right after a call's <c>(</c>, the second followed by <c>,</c> or <c>)</c>.</summary>
  [GeneratedRegex(@"\G\s*(?<capability>" + STRING_LITERAL + @")\s*,\s*(?<name>" + STRING_LITERAL + @")\s*[,)]")]
  private static partial Regex LiteralArguments();

  [GeneratedRegex(@"\\(['""\\])")]
  private static partial Regex EscapedCharacter();
}