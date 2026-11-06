namespace RevolutReader.Api.Pages;

/// <summary>
/// Serves the app's pages from the web root (spec app-delivery, c003 design.md D5). In production the web root holds the
/// frontend build (ADR-0002); locally it is empty, and Aspire's <c>web</c> resource serves the pages (D11).
/// </summary>
public static class PagesExtensions {
  /// <summary>
  /// Default and static files from the web root: <c>/</c> gets its <c>index.html</c>, and every existing file is served as
  /// it is. Both are middleware, not endpoints, so they need no entry on the anonymous-endpoint allowlist. Call it after
  /// <c>UseStatusCodePages</c> and before <c>UseFastEndpoints</c>.
  /// </summary>
  public static WebApplication UseAppPages(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    app.UseDefaultFiles();
    app.UseStaticFiles();

    return app;
  }
}