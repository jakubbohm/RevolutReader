using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// Secure by default (docs/conventions/README.md § Backend code, c001 design.md D8): only the endpoints on the allowlist
/// answer without sign-in, and every allowlist entry is a real endpoint, so the list cannot rot. The allowlist lives
/// here, in the test project, so a new anonymous endpoint shows up in the test diff.
/// </summary>
public sealed class AnonymousEndpointsTests : AcceptanceTest {
  /// <summary>
  /// Endpoints that answer without sign-in, as <c>"METHOD /route"</c>. FastEndpoints maps a <c>GET</c> endpoint for
  /// <c>GET</c> only (<c>GET /health</c> has no <c>HEAD</c> entry), so the sign-in's start has none either.
  /// </summary>
  private static readonly string[] _allowlist = [
    "GET /health",
    // The page fallback: every page address outside /api gets the app's page, which needs no sign-in (c003 design.md D5).
    "GET /{*path:regex(^(?!api(/|$)).*$):nonfile}",
    "HEAD /{*path:regex(^(?!api(/|$)).*$):nonfile}",
    // Sign-in's start and sign-out (c007 design.md D2): a visitor starts a sign-in before having one, and a refused
    // stranger must be able to sign out ("Zkusit jiný účet"); signing out without a login is harmless.
    "GET /api/auth/login",
    "POST /api/auth/logout",
    // ApiNotFound, for every method (c007 design.md D3): an address under /api that nothing else serves answers 404 to
    // everyone, a write as well as a read; it can never answer anything else.
    "* /api/{**path}",
  ];

  [Test]
  public Task Only_allowlisted_endpoints_answer_without_sign_in() {
    OpenEndpoints().Except(_allowlist).ShouldBeEmpty("Endpoints answering without sign-in that are not on the allowlist");

    return Task.CompletedTask;
  }

  [Test]
  public Task Every_allowlisted_endpoint_exists() {
    _allowlist.Except(AllEndpoints()).ShouldBeEmpty("Allowlist entries with no endpoint");

    return Task.CompletedTask;
  }

  private IReadOnlyList<string> AllEndpoints() => [.. RouteEndpoints().SelectMany(Entries)];

  private IReadOnlyList<string> OpenEndpoints() => [.. RouteEndpoints().Where(AnswersWithoutSignIn).SelectMany(Entries)];

  private IEnumerable<RouteEndpoint> RouteEndpoints() => Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>();

  /// <summary>One <c>"METHOD /route"</c> per HTTP method; <c>"* /route"</c> when the endpoint takes any method.</summary>
  private static IEnumerable<string> Entries(RouteEndpoint endpoint) {
    string route = "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/');
    IReadOnlyList<string> methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];

    return methods.Count == 0 ? [$"* {route}"] : methods.Select(method => $"{method} {route}");
  }

  /// <summary>
  /// Open: <see cref="IAllowAnonymous"/>, and nothing else (c007 design.md D3). The <c>AllowedUser</c> fallback policy
  /// protects every endpoint without authorization metadata, and the default policy every endpoint that asks for
  /// authorization without naming a policy; so only an explicit <see cref="IAllowAnonymous"/> lets a request through without
  /// sign-in. Until C6 an endpoint without metadata counted as open too (c001 design.md D8).
  /// </summary>
  private static bool AnswersWithoutSignIn(RouteEndpoint endpoint) => endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
}