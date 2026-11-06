namespace RevolutReader.Api.Pages;

/// <summary>
/// Serves the app's pages from the web root (spec app-delivery, c003 design.md D5). In production the web root holds the
/// frontend build (ADR-0002); locally it is empty, and Aspire's <c>web</c> resource serves the pages (D11).
/// </summary>
public static class PagesExtensions {
  /// <summary>
  /// The page fallback's route: every address outside <c>/api</c> (compared case-insensitively) without a file extension.
  /// An unknown address under <c>/api</c> stays the API's and answers with a problem description (spec api-errors), and
  /// so does a missing file.
  /// </summary>
  private const string PAGE_ADDRESS = "{*path:regex(^(?!api(/|$)).*$):nonfile}";

  /// <summary>The app's page in the web root.</summary>
  private const string START_PAGE = "index.html";

  /// <summary>
  /// The app's pages: default and static files from the web root, so <c>/</c> gets its <c>index.html</c> and every
  /// existing file is served as it is; then the page fallback, which answers every other page address with
  /// <c>index.html</c>, so the app opens at any address of its own. The files are middleware; the fallback is a route
  /// endpoint for <c>GET</c> and <c>HEAD</c>, listed on the anonymous-endpoint allowlist. With sign-in (C6) the fallback
  /// must stay anonymous and the files must run before authorization, because the sign-in screen is one of these pages.
  /// Call it after <c>UseStatusCodePages</c> and before <c>UseFastEndpoints</c>.
  /// </summary>
  public static WebApplication UseAppPages(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile(PAGE_ADDRESS, START_PAGE);

    return app;
  }
}