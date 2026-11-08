using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace RevolutReader.Api.SignIn;

/// <summary>Sign-in's production wiring (spec sign-in, c007 design.md D2–D4, § Public API sketch).</summary>
public static class SignInRegistration {
  /// <summary>The policy every API address requires (D3): the default and the fallback policy.</summary>
  private const string ALLOWED_USER = "AllowedUser";

  /// <summary>
  /// The cookie scheme as the default and the challenge scheme. Its login and access-denied redirects become 401 and 403
  /// without a body, so <c>UseStatusCodePages</c> answers them with the problem descriptions <c>Unauthorized</c> and
  /// <c>Forbidden</c> (D3). The <c>AllowedUser</c> policy, a signed-in user, as both the default policy (what FastEndpoints
  /// applies to an endpoint without its own settings) and the fallback policy (any other endpoint without authorization
  /// metadata), so only an explicit <c>AllowAnonymous</c> opens an address; <see cref="UnmatchedRequestsPass"/> in place of
  /// ASP.NET's authorization result handler. <see cref="TimeProvider.System"/> unless one is registered. Called from
  /// Program.cs.
  /// </summary>
  public static IServiceCollection AddSignIn(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services
      .AddAuthentication(static options => {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
      })
      .AddCookie(static options => {
        options.Events.OnRedirectToLogin = static context => AnswerWithStatus(context, StatusCodes.Status401Unauthorized);
        options.Events.OnRedirectToAccessDenied = static context => AnswerWithStatus(context, StatusCodes.Status403Forbidden);
      });

    AuthorizationPolicy allowedUser = new AuthorizationPolicyBuilder()
      .RequireAuthenticatedUser()
      .Build();

    services.AddAuthorizationBuilder()
      .AddPolicy(ALLOWED_USER, allowedUser)
      .SetDefaultPolicy(allowedUser)
      .SetFallbackPolicy(allowedUser);
    services.Replace(ServiceDescriptor.Singleton<IAuthorizationMiddlewareResultHandler, UnmatchedRequestsPass>());

    services.TryAddSingleton(TimeProvider.System);

    return services;
  }

  /// <summary>
  /// After <c>UseAppPages</c>, so the pages and their files need no sign-in, and before <c>UseFastEndpoints</c>:
  /// authentication, then authorization. A refusal counts only for a request that matched an endpoint
  /// (<see cref="UnmatchedRequestsPass"/>, D3), so an address nothing serves answers 404 to everyone.
  /// </summary>
  public static WebApplication UseSignIn(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    app.UseAuthentication();
    app.UseAuthorization();

    return app;
  }

  /// <summary>Answers the cookie handler's redirect with <paramref name="status"/> instead: no <c>Location</c>, no body.</summary>
  private static Task AnswerWithStatus(RedirectContext<CookieAuthenticationOptions> context, int status) {
    context.Response.StatusCode = status;

    return Task.CompletedTask;
  }
}