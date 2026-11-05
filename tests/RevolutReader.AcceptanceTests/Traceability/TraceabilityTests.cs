using Shouldly;

namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// Every scenario has exactly one claim (docs/conventions/testing.md, c001 design.md D7). The first test checks the
/// repository; the others feed the check made-up specs, so a check that always passes cannot look like a working one.
/// </summary>
public sealed class TraceabilityTests {
  private const string CAPABILITY = "pets";
  private const string MANUAL_LIST = "manual-scenarios.md";

  [Test]
  public void Every_scenario_is_claimed_exactly_once() {
    string root = RepositoryRoot();
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios(SpecDiscovery.MainSpecs(root), SpecDiscovery.ActiveDeltas(root));
    IReadOnlyList<ScenarioClaim> claims = [
      .. ClaimDiscovery.FromAttributes(typeof(TraceabilityTests).Assembly),
      .. ClaimDiscovery.FromManualList(File.ReadAllText(Path.Combine(root, "tests", MANUAL_LIST)), $"tests/{MANUAL_LIST}"),
    ];

    required.ShouldNotBeEmpty($"No scenarios found under {root}: the check would pass without checking anything.");
    TraceabilityCheck.Problems(required, claims).ShouldBeEmpty();
  }

  [Test]
  public void An_unclaimed_scenario_is_reported() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is fed"))], []);

    TraceabilityCheck.Problems(required, []).ShouldBe(["Not claimed: pets / Cat is fed"]);
  }

  [Test]
  public void A_scenario_claimed_twice_is_reported() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is fed"))], []);
    IReadOnlyList<ScenarioClaim> claims = [
      Claim("Cat is fed", "PetsScenarios.Cat_is_fed"),
      .. ClaimDiscovery.FromManualList(ManualList("| pets | Cat is fed | Needs a real cat | M5 | |"), MANUAL_LIST),
    ];

    TraceabilityCheck.Problems(required, claims).ShouldBe(["Claimed 2 times: pets / Cat is fed (PetsScenarios.Cat_is_fed; manual-scenarios.md line 5)"]);
  }

  [Test]
  public void A_claim_naming_an_unknown_scenario_is_reported() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is fed"))], []);
    IReadOnlyList<ScenarioClaim> claims = [Claim("Cat is fed", "PetsScenarios.Cat_is_fed"), Claim("Cat is fed at noon", "PetsScenarios.Cat_is_fed_at_noon")];

    TraceabilityCheck.Problems(required, claims).ShouldBe(["Claims a scenario that does not exist: pets / Cat is fed at noon (PetsScenarios.Cat_is_fed_at_noon)"]);
  }

  [Test]
  public void Duplicate_names_in_one_capability_are_reported() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is happy"), Requirement("Grooming", "Cat is happy"))], []);

    TraceabilityCheck.Problems(required, [Claim("Cat is happy", "PetsScenarios.Cat_is_happy")]).ShouldBe(["Scenario name used 2 times in one capability: pets / Cat is happy"]);
  }

  [Test]
  public void Every_problem_is_listed_at_once() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is fed", "Cat is fed twice"))], []);
    IReadOnlyList<ScenarioClaim> claims = [Claim("Cat is fed twice", "A.Test"), Claim("Cat is fed twice", "B.Test"), Claim("Dog is walked", "C.Test")];

    TraceabilityCheck.Problems(required, claims).ShouldBe(
      [
        "Not claimed: pets / Cat is fed",
        "Claimed 2 times: pets / Cat is fed twice (A.Test; B.Test)",
        "Claims a scenario that does not exist: pets / Dog is walked (C.Test)",
      ],
      ignoreOrder: true);
  }

  [Test]
  public void A_modified_requirement_replaces_the_main_specs_scenarios() {
    SpecFile main = MainSpec(Requirement("Feeding", "Cat is fed", "Cat is fed at noon"));
    SpecFile delta = Delta("c002-change-feeding", Section("MODIFIED", Requirement("Feeding", "Cat is fed", "Cat is fed at 7:00")));

    TraceabilityCheck.RequiredScenarios([main], [delta]).ShouldBe([Required("Cat is fed"), Required("Cat is fed at 7:00")], ignoreOrder: true);
  }

  [Test]
  public void A_removed_requirements_scenarios_are_no_longer_required() {
    SpecFile main = MainSpec(Requirement("Feeding", "Cat is fed"), Requirement("Grooming", "Cat is brushed"));
    SpecFile delta = Delta("c002-remove-grooming", Section("REMOVED", "### Requirement: Grooming\n**Reason**: The cat grooms itself.\n**Migration**: None.\n"));

    TraceabilityCheck.RequiredScenarios([main], [delta]).ShouldBe([Required("Cat is fed")]);
  }

  [Test]
  public void A_renamed_requirement_keeps_its_scenarios_under_the_new_name() {
    SpecFile main = MainSpec(Requirement("Feeding", "Cat is fed"));
    SpecFile delta = Delta(
      "c002-rename-feeding",
      Section("RENAMED", "- FROM: `### Requirement: Feeding`\n- TO: `### Requirement: Nutrition`\n"),
      Section("MODIFIED", Requirement("Nutrition", "Cat is fed", "Cat is fed at 7:00")));

    TraceabilityCheck.RequiredScenarios([main], [delta]).ShouldBe([Required("Cat is fed"), Required("Cat is fed at 7:00")], ignoreOrder: true);
  }

  [Test]
  public void A_manual_row_counts_as_a_claim() {
    IReadOnlyList<SpecScenario> required = TraceabilityCheck.RequiredScenarios([MainSpec(Requirement("Feeding", "Cat is fed"))], []);
    IReadOnlyList<ScenarioClaim> claims = ClaimDiscovery.FromManualList(ManualList("| pets | Cat is fed | Needs a real cat | M5 | |"), MANUAL_LIST);

    TraceabilityCheck.Problems(required, claims).ShouldBeEmpty();
  }

  [Test]
  public void Discovery_ignores_archived_changes() {
    string root = TemporaryRepository();
    try {
      WriteFile(root, "openspec/specs/pets/spec.md", MainSpec(Requirement("Feeding", "Cat is fed")).Markdown);
      WriteFile(root, "openspec/changes/c003-add-grooming/specs/pets/spec.md", Section("ADDED", Requirement("Grooming", "Cat is brushed")));
      WriteFile(root, "openspec/changes/archive/2026-01-01-c002-add-walking/specs/pets/spec.md", Section("ADDED", Requirement("Walking", "Cat is walked")));

      TraceabilityCheck.RequiredScenarios(SpecDiscovery.MainSpecs(root), SpecDiscovery.ActiveDeltas(root)).ShouldBe([Required("Cat is fed"), Required("Cat is brushed")], ignoreOrder: true);
    }
    finally {
      Directory.Delete(root, recursive: true);
    }
  }

  [Test]
  public void Discovery_without_main_specs_reads_the_active_deltas() {
    string root = TemporaryRepository();
    try {
      WriteFile(root, "openspec/changes/c001-add-feeding/specs/pets/spec.md", Section("ADDED", Requirement("Feeding", "Cat is fed")));

      TraceabilityCheck.RequiredScenarios(SpecDiscovery.MainSpecs(root), SpecDiscovery.ActiveDeltas(root)).ShouldBe([Required("Cat is fed")]);
    }
    finally {
      Directory.Delete(root, recursive: true);
    }
  }

  /// <summary>The repository root: the first folder above the test assembly that contains <c>openspec/</c>.</summary>
  private static string RepositoryRoot() {
    for (DirectoryInfo? folder = new(AppContext.BaseDirectory); folder is not null; folder = folder.Parent) {
      if (Directory.Exists(Path.Combine(folder.FullName, "openspec")))
        return folder.FullName;
    }

    throw new DirectoryNotFoundException($"No folder containing openspec/ above {AppContext.BaseDirectory}");
  }

  private static SpecFile MainSpec(params string[] requirements) =>
    new(CAPABILITY, string.Empty, $"# {CAPABILITY} Specification\n\n## Purpose\nA made-up capability for the traceability self-tests.\n\n## Requirements\n\n{string.Concat(requirements)}");

  private static SpecFile Delta(string changeId, params string[] sections) => new(CAPABILITY, changeId, string.Concat(sections));

  private static string Section(string operation, string body) => $"## {operation} Requirements\n\n{body}\n";

  private static string Requirement(string name, params string[] scenarios) =>
    $"### Requirement: {name}\nThe system SHALL look after the cat.\n\n{string.Concat(scenarios.Select(static scenario => $"#### Scenario: {scenario}\n- **WHEN** the owner asks\n- **THEN** the cat is looked after\n\n"))}";

  /// <summary>The manual list's real header (tests/manual-scenarios.md) with the given rows; the first row is line 5.</summary>
  private static string ManualList(params string[] rows) =>
    $"# Manual scenarios\n\n| Capability | Scenario | Why manual | Handover step | Date last checked |\n|---|---|---|---|---|\n{string.Join('\n', rows)}\n";

  private static SpecScenario Required(string name) => new(CAPABILITY, name);

  private static ScenarioClaim Claim(string name, string source) => new(CAPABILITY, name, source);

  private static string TemporaryRepository() => Directory.CreateTempSubdirectory("revolutreader-traceability-").FullName;

  private static void WriteFile(string root, string relativePath, string content) {
    string path = Path.Combine(root, relativePath);
    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
    File.WriteAllText(path, content);
  }
}