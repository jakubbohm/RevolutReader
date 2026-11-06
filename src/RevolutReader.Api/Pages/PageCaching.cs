namespace RevolutReader.Api.Pages;

/// <summary>How long a browser may keep the app's files before asking the server again (c003 design.md D5).</summary>
public static class PageCaching {
  /// <summary>
  /// Vite's hashed files: a new version gets new names, so a file never changes under its name. Matched by the folder's
  /// exact name; any other spelling falls to the safe side, "no-cache".
  /// </summary>
  private static readonly PathString _hashedFiles = new("/assets");

  private const string KEPT_FOR_A_YEAR = "public, max-age=31536000, immutable";

  /// <summary>
  /// The start page, the service worker, the manifest, the icons and the launch images keep their names across versions,
  /// so the browser asks the server first, and a new version shows on the next open (spec app-delivery).
  /// </summary>
  private const string CHECKED_WITH_THE_SERVER_FIRST = "no-cache";

  /// <summary>"public, max-age=31536000, immutable" under /assets/; "no-cache" for everything else (D5).</summary>
  public static string CacheControlFor(PathString path) => path.StartsWithSegments(_hashedFiles, StringComparison.Ordinal) ? KEPT_FOR_A_YEAR : CHECKED_WITH_THE_SERVER_FIRST;
}