namespace RevolutReader.AcceptanceTests.Traceability;

/// <summary>
/// Reads the spec files of a repository (c001 design.md D7): main specs from <c>openspec/specs/&lt;capability&gt;/spec.md</c>,
/// active deltas from <c>openspec/changes/&lt;change&gt;/specs/&lt;capability&gt;/spec.md</c>, never from
/// <c>openspec/changes/archive/</c>. A missing folder means no files.
/// </summary>
public static class SpecDiscovery {
  private const string ARCHIVE_FOLDER = "archive";
  private const string SPEC_FILE = "spec.md";

  public static IReadOnlyList<SpecFile> MainSpecs(string repositoryRoot) {
    ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);

    return SpecFiles(Path.Combine(repositoryRoot, "openspec", "specs"), string.Empty);
  }

  public static IReadOnlyList<SpecFile> ActiveDeltas(string repositoryRoot) {
    ArgumentException.ThrowIfNullOrWhiteSpace(repositoryRoot);

    string changes = Path.Combine(repositoryRoot, "openspec", "changes");
    if (!Directory.Exists(changes))
      return [];

    return [.. SortedFolders(changes)
      .Where(static change => !Path.GetFileName(change).Equals(ARCHIVE_FOLDER, StringComparison.OrdinalIgnoreCase))
      .SelectMany(static change => SpecFiles(Path.Combine(change, "specs"), Path.GetFileName(change)))];
  }

  private static IReadOnlyList<SpecFile> SpecFiles(string specsFolder, string changeId) {
    if (!Directory.Exists(specsFolder))
      return [];

    return [.. SortedFolders(specsFolder)
      .Select(static capability => (Capability: Path.GetFileName(capability), SpecPath: Path.Combine(capability, SPEC_FILE)))
      .Where(static spec => File.Exists(spec.SpecPath))
      .Select(spec => new SpecFile(spec.Capability, changeId, File.ReadAllText(spec.SpecPath)))];
  }

  private static IEnumerable<string> SortedFolders(string folder) => Directory.GetDirectories(folder).Order(StringComparer.Ordinal);
}