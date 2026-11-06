namespace RevolutReader.Api.Pages;

/// <summary>How long a browser may keep the app's files before asking the server again (c003 design.md D5).</summary>
public static class PageCaching {
  /// <summary>"public, max-age=31536000, immutable" under /assets/; "no-cache" for everything else (D5).</summary>
  public static string CacheControlFor(PathString path) => throw new NotImplementedException();
}