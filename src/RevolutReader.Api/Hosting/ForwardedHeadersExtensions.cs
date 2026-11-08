using Microsoft.AspNetCore.HttpOverrides;

namespace RevolutReader.Api.Hosting;

/// <summary>What the app takes from the hosting proxy in front of it (c007 design.md D10).</summary>
public static class ForwardedHeadersExtensions {
  /// <summary>
  /// <c>X-Forwarded-Proto</c> and <c>X-Forwarded-For</c> from the Container Apps ingress, which ends HTTPS and forwards
  /// plain HTTP, so the request reads as the visitor sent it: the OpenID Connect handler builds the app's own HTTPS return
  /// address, the rule against writes from other sites compares <c>Origin</c> against the right scheme, and the visitor's
  /// address is the client's. The known proxies and networks are cleared, because the app is reachable only through the
  /// ingress, so these headers can come from nowhere else. <c>X-Forwarded-Host</c> is not taken: the ingress keeps the
  /// visitor's <c>Host</c>, which the first deploy confirms. Call it first, before anything reads the scheme or the host.
  /// </summary>
  public static WebApplication UseForwardedHeadersFromIngress(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    ForwardedHeadersOptions ingress = new() { ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor };
    ingress.KnownProxies.Clear();
    ingress.KnownIPNetworks.Clear();

    app.UseForwardedHeaders(ingress);

    return app;
  }
}