using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The authorization result handler (c007 design.md D3). ASP.NET applies the fallback policy also to a request that matched
/// no endpoint, so an anonymous caller of an unknown address would get 401 where api-errors asks for 404. Such a request is
/// passed on unchanged; every request that matched an endpoint goes to ASP.NET's default handler and is checked as before.
/// </summary>
public sealed class UnmatchedRequestsPass : IAuthorizationMiddlewareResultHandler {
  private readonly AuthorizationMiddlewareResultHandler _default = new();

  public Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult) {
    ArgumentNullException.ThrowIfNull(next);
    ArgumentNullException.ThrowIfNull(context);

    return context.GetEndpoint() is null ? next(context) : _default.HandleAsync(next, context, policy, authorizeResult);
  }
}