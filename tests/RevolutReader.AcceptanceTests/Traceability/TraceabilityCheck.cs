using System.Text.RegularExpressions;

namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// The traceability check as pure functions (c001 design.md D7): which scenarios the specs require, and what is wrong
/// with the claims on them. Reading the repository is <see cref="SpecDiscovery"/> and <see cref="ClaimDiscovery"/>.
/// </summary>
/// <remarks>
/// The Markdown is read the way OpenSpec 1.14.3 reads it (<c>core/parsers/requirement-blocks.js</c>,
/// <c>core/specs-apply.js</c>): a main spec's requirements sit under <c>## Requirements</c>; a delta's sections are
/// applied RENAMED → REMOVED → MODIFIED → ADDED; every level-4 heading inside a requirement is a scenario (an optional
/// <c>Scenario:</c> prefix is not part of its name); fenced code is ignored, and <see cref="FencedHeadings"/> reports
/// every scenario or requirement heading a fence hides. Where OpenSpec would refuse a delta (MODIFIED of a requirement that does not
/// exist, ADDED of one that does), the delta's requirement wins, so its scenarios still need claims;
/// <c>openspec validate</c> reports the delta itself.
/// </remarks>
public static partial class TraceabilityCheck {
  private const string MAIN_SPEC_SECTION = "Requirements";
  private const string RENAMED_SECTION = "RENAMED Requirements";
  private const string REMOVED_SECTION = "REMOVED Requirements";
  private const string MODIFIED_SECTION = "MODIFIED Requirements";
  private const string ADDED_SECTION = "ADDED Requirements";
  private const char BYTE_ORDER_MARK = (char)0xFEFF;

  /// <summary>
  /// The main specs with every active delta applied per requirement, in change-id order. A list, not a set: two
  /// scenarios with the same name in one capability both stay in it, so <see cref="Problems"/> can report them.
  /// </summary>
  public static IReadOnlyList<SpecScenario> RequiredScenarios(IReadOnlyList<SpecFile> mainSpecs, IReadOnlyList<SpecFile> activeDeltas) {
    ArgumentNullException.ThrowIfNull(mainSpecs);
    ArgumentNullException.ThrowIfNull(activeDeltas);

    SortedDictionary<string, List<Requirement>> capabilities = new(StringComparer.Ordinal);

    foreach (SpecFile spec in mainSpecs)
      RequirementsOf(capabilities, spec.Capability).AddRange(MainSpecRequirements(spec.Markdown));

    foreach (SpecFile delta in activeDeltas.OrderBy(static delta => delta.ChangeId, StringComparer.Ordinal))
      ApplyDelta(RequirementsOf(capabilities, delta.Capability), delta.Markdown);

    return [.. capabilities.SelectMany(static capability => capability.Value.SelectMany(requirement => requirement.Scenarios.Select(name => new SpecScenario(capability.Key, name))))];
  }

  /// <summary>Every problem at once: duplicate names in a capability, unclaimed scenarios, scenarios claimed more than once, claims naming no scenario.</summary>
  public static IReadOnlyList<string> Problems(IReadOnlyList<SpecScenario> required, IReadOnlyList<ScenarioClaim> claims) {
    ArgumentNullException.ThrowIfNull(required);
    ArgumentNullException.ThrowIfNull(claims);

    List<string> problems = [];

    foreach (IGrouping<SpecScenario, SpecScenario> sameName in required.GroupBy(static scenario => scenario).Where(static group => group.Count() > 1))
      problems.Add($"Scenario name used {sameName.Count()} times in one capability: {Describe(sameName.Key)}");

    ILookup<SpecScenario, ScenarioClaim> claimsOf = claims.ToLookup(static claim => new SpecScenario(claim.Capability, claim.Name));
    foreach (SpecScenario scenario in required.Distinct()) {
      ScenarioClaim[] scenarioClaims = [.. claimsOf[scenario]];
      if (scenarioClaims.Length == 0)
        problems.Add($"Not claimed: {Describe(scenario)}");
      else if (scenarioClaims.Length > 1)
        problems.Add($"Claimed {scenarioClaims.Length} times: {Describe(scenario)} ({string.Join("; ", scenarioClaims.Select(static claim => claim.Source))})");
    }

    HashSet<SpecScenario> existing = [.. required];
    foreach (ScenarioClaim claim in claims.Where(claim => !existing.Contains(new SpecScenario(claim.Capability, claim.Name))))
      problems.Add($"Claims a scenario that does not exist: {claim.Capability} / {claim.Name} ({claim.Source})");

    return problems;
  }

  /// <summary>
  /// Every scenario or requirement heading inside a fenced code block. <see cref="RequiredScenarios"/> requires no claim
  /// for a fenced scenario, and a scenario whose requirement heading is fenced is dropped, or counted under the
  /// requirement above it, even when the fence closes before the scenario. Fences are read as OpenSpec reads them, more
  /// loosely than CommonMark: a line such as <c>```json``` example</c> opens one, which hides everything up to the next
  /// fence line, and a fence never closed hides everything to the end of the file, without a word; <c>openspec
  /// validate</c> does not notice either. A heading inside a properly closed fence is reported too, so a spec that needs
  /// such a heading in an example writes it some other way. A fenced section heading (<c>## </c>) is not reported: that
  /// prefix is common in comments inside examples.
  /// </summary>
  public static IReadOnlyList<string> FencedHeadings(IReadOnlyList<SpecFile> specs) {
    ArgumentNullException.ThrowIfNull(specs);

    List<string> problems = [];

    foreach (SpecFile spec in specs) {
      string[] lines = Lines(spec.Markdown);
      string[] unfenced = UnfencedLines(spec.Markdown);

      for (int index = 0; index < lines.Length; index++) {
        if (unfenced[index].Length != 0)
          continue;

        if (ScenarioHeading().Match(lines[index]) is { Success: true } scenario)
          problems.Add($"Inside a code fence, so no claim is required: {spec.Capability} / {ScenarioName(scenario)} ({Describe(spec)} line {index + 1})");
        else if (RequirementHeading().Match(lines[index]) is { Success: true } requirement)
          problems.Add($"Requirement heading inside a code fence, so its scenarios are dropped or counted under the requirement above it: {spec.Capability} / {HeadingName(requirement.Groups[1].Value)} ({Describe(spec)} line {index + 1})");
      }
    }

    return problems;
  }

  private static string Describe(SpecScenario scenario) => $"{scenario.Capability} / {scenario.Name}";

  private static string Describe(SpecFile spec) =>
    spec.ChangeId.Length == 0 ? $"openspec/specs/{spec.Capability}/spec.md" : $"openspec/changes/{spec.ChangeId}/specs/{spec.Capability}/spec.md";

  private static List<Requirement> RequirementsOf(SortedDictionary<string, List<Requirement>> capabilities, string capability) {
    if (!capabilities.TryGetValue(capability, out List<Requirement>? requirements)) {
      requirements = [];
      capabilities.Add(capability, requirements);
    }

    return requirements;
  }

  private static IEnumerable<Requirement> MainSpecRequirements(string markdown) =>
    Sections(markdown).Where(static section => IsTitled(section, MAIN_SPEC_SECTION)).SelectMany(static section => RequirementBlocks(section.Lines));

  private static void ApplyDelta(List<Requirement> requirements, string markdown) {
    Section[] sections = [.. Sections(markdown)];

    foreach ((string from, string to) in Bodies(sections, RENAMED_SECTION).SelectMany(RenamePairs))
      Rename(requirements, from, to);

    foreach (string name in Bodies(sections, REMOVED_SECTION).SelectMany(RemovedNames))
      requirements.RemoveAll(requirement => requirement.Name == name);

    foreach (Requirement requirement in Bodies(sections, MODIFIED_SECTION).SelectMany(RequirementBlocks))
      Upsert(requirements, requirement);

    foreach (Requirement requirement in Bodies(sections, ADDED_SECTION).SelectMany(RequirementBlocks))
      Upsert(requirements, requirement);
  }

  private static void Rename(List<Requirement> requirements, string from, string to) {
    int index = requirements.FindIndex(requirement => requirement.Name == from);
    if (index >= 0 && !requirements.Exists(requirement => requirement.Name == to))
      requirements[index] = requirements[index] with { Name = to };
  }

  private static void Upsert(List<Requirement> requirements, Requirement requirement) {
    int index = requirements.FindIndex(existing => existing.Name == requirement.Name);
    if (index >= 0)
      requirements[index] = requirement;
    else
      requirements.Add(requirement);
  }

  private static IEnumerable<IReadOnlyList<string>> Bodies(IEnumerable<Section> sections, string title) =>
    sections.Where(section => IsTitled(section, title)).Select(static section => section.Lines);

  private static bool IsTitled(Section section, string title) => section.Title.Equals(title, StringComparison.OrdinalIgnoreCase);

  /// <summary>The <c>## </c> sections of a spec, each with the lines below it; fenced lines are blank.</summary>
  private static IEnumerable<Section> Sections(string markdown) {
    string? title = null;
    List<string> body = [];

    foreach (string line in UnfencedLines(markdown)) {
      Match heading = SectionHeading().Match(line);
      if (heading.Success) {
        if (title is not null)
          yield return new(title, body);

        title = heading.Groups[1].Value.Trim();
        body = [];
      }
      else if (title is not null)
        body.Add(line);
    }

    if (title is not null)
      yield return new(title, body);
  }

  private static IEnumerable<Requirement> RequirementBlocks(IReadOnlyList<string> lines) {
    string? name = null;
    List<string> scenarios = [];

    foreach (string line in lines) {
      Match requirement = RequirementHeading().Match(line);
      if (requirement.Success) {
        if (name is not null)
          yield return new(name, scenarios);

        name = HeadingName(requirement.Groups[1].Value);
        scenarios = [];
        continue;
      }

      Match scenario = ScenarioHeading().Match(line);
      if (name is not null && scenario.Success)
        scenarios.Add(ScenarioName(scenario));
    }

    if (name is not null)
      yield return new(name, scenarios);
  }

  private static IEnumerable<string> RemovedNames(IReadOnlyList<string> lines) {
    foreach (string line in lines) {
      Match removed = RequirementHeading().Match(line);
      if (!removed.Success)
        removed = RemovedBullet().Match(line);

      if (removed.Success)
        yield return HeadingName(removed.Groups[1].Value);
    }
  }

  /// <summary>A <c>FROM:</c> followed by a <c>TO:</c>; any other order pairs nothing (OpenSpec refuses such a delta).</summary>
  private static IEnumerable<(string From, string To)> RenamePairs(IReadOnlyList<string> lines) {
    string? from = null;

    foreach (string line in lines) {
      Match fromLine = RenameFrom().Match(line);
      Match toLine = RenameTo().Match(line);
      if (fromLine.Success)
        from = HeadingName(fromLine.Groups[1].Value);
      else if (toLine.Success && from is not null) {
        yield return (from, HeadingName(toLine.Groups[1].Value));
        from = null;
      }
    }
  }

  /// <summary>A heading's text without an ATX closing run of <c>#</c> (<c>### Requirement: Foo ###</c> is <c>Foo</c>).</summary>
  private static string HeadingName(string text) => ClosingHashes().Replace(text, string.Empty).Trim();

  /// <summary>A scenario heading's name, without an optional <c>Scenario:</c> prefix.</summary>
  private static string ScenarioName(Match scenario) => ScenarioPrefix().Replace(HeadingName(scenario.Groups[1].Value), string.Empty).Trim();

  private static string[] Lines(string markdown) => markdown.TrimStart(BYTE_ORDER_MARK).ReplaceLineEndings("\n").Split('\n');

  /// <summary>The lines of a Markdown text, with every line of a fenced code block (fences included) blanked.</summary>
  private static string[] UnfencedLines(string markdown) {
    string[] lines = Lines(markdown);
    char fenceMarker = default;
    int fenceLength = 0; // 0: outside a fenced block

    for (int index = 0; index < lines.Length; index++) {
      if (fenceLength == 0) {
        Match opening = FenceOpening().Match(lines[index]);
        if (!opening.Success)
          continue;

        fenceMarker = opening.Groups[1].Value[0];
        fenceLength = opening.Groups[1].Length;
      }
      else if (FenceClosing().Match(lines[index]) is { Success: true } closing && closing.Groups[1].Value[0] == fenceMarker && closing.Groups[1].Length >= fenceLength)
        fenceLength = 0;

      lines[index] = string.Empty;
    }

    return lines;
  }

  [GeneratedRegex(@"^##\s+(.+)$")]
  private static partial Regex SectionHeading();

  [GeneratedRegex(@"^###\s*Requirement:\s*(.+)$", RegexOptions.IgnoreCase)]
  private static partial Regex RequirementHeading();

  [GeneratedRegex(@"^####\s+(.*)$")]
  private static partial Regex ScenarioHeading();

  [GeneratedRegex(@"^Scenario:\s*", RegexOptions.IgnoreCase)]
  private static partial Regex ScenarioPrefix();

  [GeneratedRegex(@"^\s*[-*+]\s*`?###\s*Requirement:\s*(.+?)`?\s*$", RegexOptions.IgnoreCase)]
  private static partial Regex RemovedBullet();

  [GeneratedRegex(@"^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$", RegexOptions.IgnoreCase)]
  private static partial Regex RenameFrom();

  [GeneratedRegex(@"^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$", RegexOptions.IgnoreCase)]
  private static partial Regex RenameTo();

  [GeneratedRegex(@"[ \t]+#+[ \t]*$")]
  private static partial Regex ClosingHashes();

  [GeneratedRegex(@"^\s*(`{3,}|~{3,})")]
  private static partial Regex FenceOpening();

  [GeneratedRegex(@"^\s*(`{3,}|~{3,})\s*$")]
  private static partial Regex FenceClosing();

  private sealed record Requirement(string Name, IReadOnlyList<string> Scenarios);

  private sealed record Section(string Title, IReadOnlyList<string> Lines);
}