using Microsoft.AspNetCore.Http;
using RevolutReader.Api.Security;
using Shouldly;

namespace RevolutReader.UnitTests.Security;

/// <summary>
/// The rule against writes from other sites (c007 design.md D4), one row of its table per behaviour. It applies to every
/// write (POST, PUT, PATCH or DELETE) to a path under <c>/api</c>:
/// <list type="bullet">
/// <item>the sign-in return <c>/api/auth/signin-oidc</c> is passed on;</item>
/// <item><c>Sec-Fetch-Site: same-origin</c> or <c>none</c> is allowed; any other <c>Sec-Fetch-Site</c> is refused;</item>
/// <item>without <c>Sec-Fetch-Site</c>, an <c>Origin</c> is allowed only when it is exactly the request's own (scheme,
/// host and port);</item>
/// <item>with neither header, the request is allowed (not a browser).</item>
/// </list>
/// Every other request passes. "Under <c>/api</c>" is by path segment and ignores letter case, as ASP.NET's routing
/// matches paths; methods ignore letter case too, so a lowercase method is no way around the rule. The app's own origin
/// here is <see cref="APP"/>; every address is made up.
/// </summary>
public sealed class CrossSiteWritesTests {
  /// <summary>The request's own origin, as the app sees it behind the hosting proxy (D10).</summary>
  private const string APP = "https://tarjeta.example.net";

  /// <summary>Another app on the same hosting domain: the same site, another origin (D4).</summary>
  private const string NEIGHBOUR = "https://jina-appka.example.net";

  /// <summary>A site that has nothing to do with the app.</summary>
  private const string OTHER_SITE = "https://cizi-web.example.org";

  /// <summary>The origin a sandboxed page or a privacy-sensitive redirect sends: the string <c>null</c>.</summary>
  private const string OPAQUE_ORIGIN = "null";

  private const string SAME_ORIGIN = "same-origin";
  private const string NONE = "none";
  private const string SAME_SITE = "same-site";
  private const string CROSS_SITE = "cross-site";

  /// <summary>A write the API serves: the sign-out (D2).</summary>
  private const string SIGN_OUT = "/api/auth/logout";

  /// <summary>The sign-in return, Microsoft's form post (D2).</summary>
  private const string SIGN_IN_RETURN = "/api/auth/signin-oidc";

  /// <summary>Fetch metadata and origin in every combination a test means by "whatever its headers", friendly and hostile.</summary>
  private static readonly Headers[] _anyHeaders = [
    new(SAME_ORIGIN, APP),
    new(NONE, null),
    new(SAME_SITE, NEIGHBOUR),
    new(CROSS_SITE, OTHER_SITE),
    new(null, APP),
    new(null, OTHER_SITE),
    new(null, OPAQUE_ORIGIN),
    new(null, null),
  ];

  [Test]
  [Arguments("GET")]
  [Arguments("HEAD")]
  [Arguments("OPTIONS")]
  [Arguments("get")]
  public void A_read_passes_whatever_its_headers(string method) =>
    _anyHeaders.Where(headers => !CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), headers.SecFetchSite, headers.Origin, APP))
      .ShouldBeEmpty($"{method} refused with these headers");

  [Test]
  [Arguments("POST", APP)]
  [Arguments("PUT", APP)]
  [Arguments("PATCH", APP)]
  [Arguments("DELETE", APP)]
  [Arguments("POST", null)] // a page's write without an Origin header
  public void A_write_from_the_apps_own_page_is_allowed(string method, string? origin) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), SAME_ORIGIN, origin, APP).ShouldBeTrue();

  [Test]
  [Arguments("POST")]
  [Arguments("PUT")]
  [Arguments("PATCH")]
  [Arguments("DELETE")]
  public void A_write_the_user_started_directly_is_allowed(string method) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), NONE, origin: null, APP).ShouldBeTrue();

  [Test]
  [Arguments("POST", SAME_SITE, NEIGHBOUR)]
  [Arguments("PUT", SAME_SITE, NEIGHBOUR)]
  [Arguments("PATCH", SAME_SITE, NEIGHBOUR)]
  [Arguments("DELETE", SAME_SITE, NEIGHBOUR)]
  [Arguments("post", SAME_SITE, NEIGHBOUR)] // a lowercase method is still a write
  [Arguments("POST", "Same-Site", NEIGHBOUR)] // the value in other letter case is still not same-origin or none
  [Arguments("POST", SAME_SITE, APP)] // Sec-Fetch-Site decides when present; the Origin cannot overrule it
  public void A_write_from_a_neighbouring_site_on_the_same_domain_is_refused(string method, string secFetchSite, string origin) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), secFetchSite, origin, APP).ShouldBeFalse();

  [Test]
  [Arguments("POST", SIGN_OUT, CROSS_SITE)]
  [Arguments("PUT", SIGN_OUT, CROSS_SITE)]
  [Arguments("PATCH", SIGN_OUT, CROSS_SITE)]
  [Arguments("DELETE", SIGN_OUT, CROSS_SITE)]
  [Arguments("POST", SIGN_OUT, "CROSS-SITE")] // the value in other letter case
  [Arguments("POST", "/API/auth/logout", CROSS_SITE)] // the path in other letter case is still under /api
  [Arguments("POST", "/api", CROSS_SITE)] // /api itself is under /api
  [Arguments("POST", "/api/no-such-address", CROSS_SITE)] // an address nothing serves is still under /api
  [Arguments("POST", $"{SIGN_IN_RETURN}/more", CROSS_SITE)] // only the sign-in return itself is exempt, not what lies below it
  public void A_write_from_another_site_is_refused(string method, string path, string secFetchSite) =>
    CrossSiteWrites.IsAllowed(method, new PathString(path), secFetchSite, OTHER_SITE, APP).ShouldBeFalse();

  [Test]
  [Arguments("POST")]
  [Arguments("PUT")]
  [Arguments("PATCH")]
  [Arguments("DELETE")]
  public void A_write_without_fetch_metadata_but_with_the_apps_own_origin_is_allowed(string method) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), secFetchSite: null, APP, APP).ShouldBeTrue();

  [Test]
  [Arguments("POST", NEIGHBOUR)]
  [Arguments("PUT", OTHER_SITE)]
  [Arguments("PATCH", OTHER_SITE)]
  [Arguments("DELETE", OTHER_SITE)]
  [Arguments("POST", OPAQUE_ORIGIN)] // a sandboxed page
  [Arguments("POST", "http://tarjeta.example.net")] // the app's host on another scheme
  [Arguments("POST", "https://tarjeta.example.net:8443")] // the app's host on another port
  [Arguments("POST", "https://tarjeta.example.net.example.org")] // starts with the app's origin
  public void A_write_without_fetch_metadata_from_another_origin_is_refused(string method, string origin) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), secFetchSite: null, origin, APP).ShouldBeFalse();

  [Test]
  [Arguments("POST")]
  [Arguments("PUT")]
  [Arguments("PATCH")]
  [Arguments("DELETE")]
  public void A_write_with_neither_header_is_allowed(string method) =>
    CrossSiteWrites.IsAllowed(method, new PathString(SIGN_OUT), secFetchSite: null, origin: null, APP).ShouldBeTrue();

  [Test]
  [Arguments(SIGN_IN_RETURN)]
  [Arguments("/API/Auth/SignIn-OIDC")] // as the handler matches its return address: ignoring letter case
  public void The_sign_in_return_is_passed_on_whatever_its_headers(string path) =>
    _anyHeaders.Where(headers => !CrossSiteWrites.IsAllowed("POST", new PathString(path), headers.SecFetchSite, headers.Origin, APP))
      .ShouldBeEmpty($"POST {path} refused with these headers");

  [Test]
  [Arguments("POST", "/no-such-page")]
  [Arguments("PUT", "/")]
  [Arguments("PATCH", "/signout-oidc")]
  [Arguments("DELETE", "/apix")] // not under /api: another first segment
  [Arguments("POST", "/apix/auth/logout")]
  public void A_write_outside_api_is_passed_on(string method, string path) =>
    _anyHeaders.Where(headers => !CrossSiteWrites.IsAllowed(method, new PathString(path), headers.SecFetchSite, headers.Origin, APP))
      .ShouldBeEmpty($"{method} {path} refused with these headers");

  /// <summary>A request's <c>Sec-Fetch-Site</c> and <c>Origin</c>; <see langword="null"/>: the header is missing.</summary>
  private sealed record Headers(string? SecFetchSite, string? Origin);
}