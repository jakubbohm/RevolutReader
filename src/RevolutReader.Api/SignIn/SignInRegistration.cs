using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace RevolutReader.Api.SignIn;

/// <summary>Sign-in's production wiring (spec sign-in, c007 design.md D2–D4, § Public API sketch).</summary>
public static class SignInRegistration {
  /// <summary>The policy every API address requires (D3): the default and the fallback policy.</summary>
  private const string ALLOWED_USER = "AllowedUser";

  /// <summary>Every sign-in cookie's path (D4): the whole app, as the <c>__Host-</c> prefix requires.</summary>
  private const string WHOLE_APP = "/";

  /// <summary>The scopes asked of Microsoft (D3): the sign-in itself, the account's name, and its email address.</summary>
  private static readonly string[] _scopes = ["openid", "profile", "email"];

  /// <summary>How long the login lasts without use (D4): 30 days, renewed while the app is used.</summary>
  private static readonly TimeSpan _loginLifetime = TimeSpan.FromDays(30);

  /// <summary>
  /// The <c>SignIn</c> settings, bound and validated at start (<see cref="SignInOptionsValidator"/>). The cookie scheme as
  /// the default and the challenge scheme: the login cookie <see cref="SignInCookies.SESSION"/> (D4), and its login and
  /// access-denied redirects become 401 and 403 without a body, so <c>UseStatusCodePages</c> answers them with the problem
  /// descriptions <c>Unauthorized</c> and <c>Forbidden</c> (D3). OpenID Connect against Microsoft (D2–D4), which only
  /// <see cref="LoginEndpoint"/> challenges, by name. The <c>AllowedUser</c> policy, a signed-in user, as both the default
  /// policy (what FastEndpoints applies to an endpoint without its own settings) and the fallback policy (any other endpoint
  /// without authorization metadata), so only an explicit <c>AllowAnonymous</c> opens an address;
  /// <see cref="UnmatchedRequestsPass"/> in place of ASP.NET's authorization result handler. <see cref="TimeProvider.System"/>
  /// unless one is registered. Called from Program.cs.
  /// </summary>
  public static IServiceCollection AddSignIn(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<SignInOptions>()
      .BindConfiguration(SignInOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<SignInOptions>, SignInOptionsValidator>();

    services
      .AddAuthentication(static options => {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
      })
      .AddCookie(static options => {
        options.Cookie.Name = SignInCookies.SESSION;
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.Path = WHOLE_APP;
        options.ExpireTimeSpan = _loginLifetime;
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = static context => AnswerWithStatus(context, StatusCodes.Status401Unauthorized);
        options.Events.OnRedirectToAccessDenied = static context => AnswerWithStatus(context, StatusCodes.Status403Forbidden);
      })
      .AddOpenIdConnect(static options => {
        options.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.ResponseType = OpenIdConnectResponseType.Code;
        options.ResponseMode = OpenIdConnectResponseMode.FormPost;
        options.UsePkce = true;
        options.CallbackPath = SignInAddresses.CALLBACK;
        // The ID token's short claim names stay as they are, so the login holds "name" and "email".
        options.MapInboundClaims = false;
        options.Scope.Clear();

        foreach (string scope in _scopes)
          options.Scope.Add(scope);

        options.CorrelationCookie.Name = $"{SignInCookies.ROUND_TRIP_PREFIX}correlation.";
        options.NonceCookie.Name = $"{SignInCookies.ROUND_TRIP_PREFIX}nonce.";
        RoundTripCookie(options.CorrelationCookie);
        RoundTripCookie(options.NonceCookie);
      });

    services.AddOptions<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme)
      .Configure<IOptions<SignInOptions>>(static (options, settings) => {
        options.Authority = settings.Value.Authority.AbsoluteUri;
        options.ClientId = settings.Value.ClientId;
        options.ClientSecret = settings.Value.ClientSecret;
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

  /// <summary>
  /// A correlation or nonce cookie of the round trip to Microsoft (D4): Path <c>/</c> for the <c>__Host-</c> prefix (the
  /// handler's default is the return address), and SameSite None, so Microsoft's cross-site POST brings it back.
  /// </summary>
  private static void RoundTripCookie(CookieBuilder cookie) {
    cookie.Path = WHOLE_APP;
    cookie.HttpOnly = true;
    cookie.SecurePolicy = CookieSecurePolicy.Always;
    cookie.SameSite = SameSiteMode.None;
  }

  /// <summary>Answers the cookie handler's redirect with <paramref name="status"/> instead: no <c>Location</c>, no body.</summary>
  private static Task AnswerWithStatus(RedirectContext<CookieAuthenticationOptions> context, int status) {
    context.Response.StatusCode = status;

    return Task.CompletedTask;
  }
}