namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// The page folder every test app copy serves instead of the frontend build (c003 design.md D6): the output copy of
/// <c>Drivers/StandInPages/</c>, set as the web root in <see cref="AcceptanceTest"/>. The tests check the backend's
/// serving rules, not the build, so "the app's page" is this folder's <c>index.html</c>.
/// </summary>
public static class StandInPages {
  /// <summary>The folder, as copied to the test output.</summary>
  public static string Folder { get; } = Path.Combine(AppContext.BaseDirectory, "Drivers", "StandInPages");

  /// <summary>The folder's <c>index.html</c>, as text.</summary>
  public static string StartPage { get; } = File.ReadAllText(Path.Combine(Folder, "index.html"));
}