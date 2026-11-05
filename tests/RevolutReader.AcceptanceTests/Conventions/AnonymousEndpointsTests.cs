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
  /// <summary>Endpoints that answer without sign-in, as <c>"METHOD /route"</c>.</summary>
  private static readonly string[] _allowlist = [
    "GET /health",
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
  /// Open: <see cref="IAllowAnonymous"/>, or no authorization metadata at all (D8). Once C6 adds a fallback policy,
  /// endpoints without metadata are protected by it and only <see cref="IAllowAnonymous"/> counts.
  /// </summary>
  private static bool AnswersWithoutSignIn(RouteEndpoint endpoint) =>
    endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null
    || (endpoint.Metadata.GetMetadata<IAuthorizeData>() is null
      && endpoint.Metadata.GetMetadata<AuthorizationPolicy>() is null
      && endpoint.Metadata.GetMetadata<IAuthorizationRequirementData>() is null);
}