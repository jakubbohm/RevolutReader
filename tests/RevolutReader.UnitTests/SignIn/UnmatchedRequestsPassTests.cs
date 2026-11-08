using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using RevolutReader.Api.SignIn;
using Shouldly;

namespace RevolutReader.UnitTests.SignIn;

/// <summary>
/// The authorization result handler lets a request that matched no address go on unchanged, so it answers as the app
/// answers an unknown address, while a request that matched one is checked (c007 design.md D3). The router's own method
/// rejection (the "405 method not allowed" endpoint, a plain <see cref="Endpoint"/> with no metadata, not a
/// <see cref="RouteEndpoint"/>) matched no address either. Each test hands the handler an anonymous caller's request that
/// the fallback policy refused, and records what happened to it: passed on to the rest of the pipeline, or challenged
/// (or forbidden) through the app's authentication service, a hand-written fake here.
/// </summary>
public sealed class UnmatchedRequestsPassTests {
  private const string PASSED_ON = "passed on";
  private const string CHALLENGED = "challenged";
  private const string FORBIDDEN = "forbidden";

  /// <summary>The fallback policy as the app builds it today: a signed-in user.</summary>
  private static readonly AuthorizationPolicy _signedInUser = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();

  [Test]
  public async Task A_request_matched_only_by_the_routers_method_rejection_is_passed_on_as_an_unmatched_one_is() {
    // As ASP.NET's HTTP method matcher builds its rejection: no route pattern, no metadata.
    Endpoint methodRejection = new(static _ => Task.CompletedTask, EndpointMetadataCollection.Empty, "405 HTTP Method Not Supported");

    (await WhatHappensTo(methodRejection)).ShouldBe([PASSED_ON]);
  }

  /// <summary>The contrast: an address that exists is checked, so the refused anonymous caller is challenged (the 401).</summary>
  [Test]
  public async Task A_refused_request_that_matched_an_address_is_challenged_not_passed_on() {
    RouteEndpoint address = new(static _ => Task.CompletedTask, RoutePatternFactory.Parse("/api/me"), 0, EndpointMetadataCollection.Empty, "GET /api/me");

    (await WhatHappensTo(address)).ShouldBe([CHALLENGED]);
  }

  /// <summary>An anonymous caller's request matched to <paramref name="endpoint"/>, refused by the policy, through the handler.</summary>
  private static async Task<IReadOnlyList<string>> WhatHappensTo(Endpoint endpoint) {
    List<string> outcomes = [];
    DefaultHttpContext context = new() { RequestServices = new Services(new RecordingAuthentication(outcomes)) };
    context.SetEndpoint(endpoint);

    await new UnmatchedRequestsPass().HandleAsync(
      _ => {
        outcomes.Add(PASSED_ON);

        return Task.CompletedTask;
      },
      context,
      _signedInUser,
      PolicyAuthorizationResult.Challenge());

    return outcomes;
  }

  /// <summary>The request's services: only the authentication service.</summary>
  private sealed class Services(IAuthenticationService authentication) : IServiceProvider {
    public object? GetService(Type serviceType) => serviceType == typeof(IAuthenticationService) ? authentication : null;
  }

  /// <summary>Records a challenge or a forbid; nothing in these tests authenticates, signs in or signs out.</summary>
  private sealed class RecordingAuthentication(List<string> outcomes) : IAuthenticationService {
    public Task<AuthenticateResult> AuthenticateAsync(HttpContext context, string? scheme) => Task.FromResult(AuthenticateResult.NoResult());

    public Task ChallengeAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) {
      outcomes.Add(CHALLENGED);

      return Task.CompletedTask;
    }

    public Task ForbidAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) {
      outcomes.Add(FORBIDDEN);

      return Task.CompletedTask;
    }

    public Task SignInAsync(HttpContext context, string? scheme, ClaimsPrincipal principal, AuthenticationProperties? properties) =>
      throw new NotSupportedException("The authorization result handler never signs in.");

    public Task SignOutAsync(HttpContext context, string? scheme, AuthenticationProperties? properties) =>
      throw new NotSupportedException("The authorization result handler never signs out.");
  }
}