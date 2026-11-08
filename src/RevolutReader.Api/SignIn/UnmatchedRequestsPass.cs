using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The authorization result handler (c007 design.md D3). ASP.NET applies the fallback policy also to a request that matched
/// no address: one with no endpoint, or with only the router's "405 method not allowed" rejection, a plain endpoint rather
/// than a <see cref="RouteEndpoint"/>. An anonymous caller would get 401 there instead of the app's 404 or 405. Such a
/// request is passed on unchanged; every request that matched an address goes to ASP.NET's default handler and is checked
/// as before.
/// </summary>
public sealed class UnmatchedRequestsPass : IAuthorizationMiddlewareResultHandler {
  private readonly AuthorizationMiddlewareResultHandler _default = new();

  public Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult) {
    ArgumentNullException.ThrowIfNull(next);
    ArgumentNullException.ThrowIfNull(context);

    return context.GetEndpoint() is RouteEndpoint ? _default.HandleAsync(next, context, policy, authorizeResult) : next(context);
  }
}