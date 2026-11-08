using Microsoft.Extensions.Primitives;

namespace RevolutReader.Api.Security;

/// <summary>Applies <see cref="CrossSiteWrites"/> to every request (c007 design.md D4).</summary>
public static class CrossSiteWriteProtection {
  private const string SEC_FETCH_SITE = "Sec-Fetch-Site";

  /// <summary>
  /// A request <see cref="CrossSiteWrites.IsAllowed(string, PathString, StringValues, StringValues, string)"/> refuses is
  /// answered 403 with the problem description <c>Forbidden</c>, written through <see cref="IProblemDetailsService"/>, and
  /// goes no further, so its endpoint never runs and nothing changes. Which requests that is, repeated headers included,
  /// is the rule's alone. The request's own origin comes from its scheme and host, so behind the hosting proxy the
  /// forwarded headers must run first (D10). Call it after <c>UseAuthorization</c> and before <c>UseFastEndpoints</c>
  /// (<c>UseSignIn</c> does); the sign-in return's exemption is part of the rule, so it does not depend on this place.
  /// </summary>
  public static WebApplication UseCrossSiteWriteProtection(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    app.Use(static async (context, next) => {
      if (IsAllowed(context.Request)) {
        await next(context);

        return;
      }

      context.Response.StatusCode = StatusCodes.Status403Forbidden;

      // A caller that rules JSON out gets no problem description here; UseStatusCodePages then answers the bare 403 with
      // its plain-text status line, as for every other error (spec api-errors).
      _ = await context.RequestServices.GetRequiredService<IProblemDetailsService>().TryWriteAsync(new ProblemDetailsContext { HttpContext = context });
    });

    return app;
  }

  private static bool IsAllowed(HttpRequest request) =>
    CrossSiteWrites.IsAllowed(request.Method, request.Path, request.Headers[SEC_FETCH_SITE], request.Headers.Origin, OwnOrigin(request));

  /// <summary>
  /// The request's own origin, written as a browser writes an <c>Origin</c>: lowercase scheme and host, without the
  /// scheme's default port, with any other port. Empty when the request names no usable host.
  /// </summary>
  private static string OwnOrigin(HttpRequest request) =>
    Uri.TryCreate($"{request.Scheme}://{request.Host.ToUriComponent()}", UriKind.Absolute, out Uri? own) ? own.GetLeftPart(UriPartial.Authority) : string.Empty;
}