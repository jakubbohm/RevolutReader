using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using RevolutReader.Api.Security;

namespace RevolutReader.Api.SignIn;

/// <summary>Sign-in's production wiring (spec sign-in, c007 design.md D2–D4, § Public API sketch).</summary>
public static class SignInRegistration {
  /// <summary>The policy every API address requires (D3): the default and the fallback policy.</summary>
  private const string ALLOWED_USER = "AllowedUser";

  /// <summary>Every sign-in cookie's path (D4): the whole app, as the <c>__Host-</c> prefix requires.</summary>
  private const string WHOLE_APP = "/";

  /// <summary>The 403 problem description's extension naming the refused account's own email address (D3).</summary>
  private const string EMAIL_EXTENSION = "email";

  /// <summary>The category of <see cref="SignInLog"/>'s lines.</summary>
  private const string LOG_CATEGORY = "RevolutReader.Api.SignIn";

  /// <summary>Where the OpenID Connect handler keeps Microsoft's <c>error</c> code on the exception for an error answer.</summary>
  private const string ERROR_CODE = "error";

  /// <summary>The longest error code from Microsoft that is logged as it is (<see cref="IsErrorCode"/>).</summary>
  private const int LONGEST_ERROR_CODE = 64;

  /// <summary>The scopes asked of Microsoft (D3): the sign-in itself, the account's name, and its email address.</summary>
  private static readonly string[] _scopes = ["openid", "profile", "email"];

  /// <summary>How long the login lasts without use (D4): 30 days, renewed while the app is used.</summary>
  private static readonly TimeSpan _loginLifetime = TimeSpan.FromDays(30);

  /// <summary>
  /// The <c>SignIn</c> settings, bound and validated at start (<see cref="SignInOptionsValidator"/>). The cookie scheme as
  /// the default and the challenge scheme: the login cookie <see cref="SignInCookies.SESSION"/> (D4), and its login and
  /// access-denied redirects become 401 and 403 without a body, so <c>UseStatusCodePages</c> answers them with the problem
  /// descriptions <c>Unauthorized</c> and <c>Forbidden</c>; a 403 for a signed-in account names its own email address (D3).
  /// OpenID Connect against Microsoft (D2–D4), which only <see cref="LoginEndpoint"/> challenges, by name; a sign-in by an
  /// account not on the allowlist is logged once, as <see cref="SignInLog.SignInRefused"/>, and still completes; a sign-in
  /// that is cancelled or fails lands on <see cref="SignInAddresses.LANDING"/>, signed out, and is logged without a token,
  /// an email address or an exception message (D3). The
  /// <c>AllowedUser</c> policy, a signed-in user on the allowlist (<see cref="AllowedUserRequirement"/>, the
  /// <see cref="Allowlist"/> parsed once from the validated settings), as both the default policy (what FastEndpoints
  /// applies to an endpoint without its own settings) and the fallback policy (any other endpoint without authorization
  /// metadata), so only an explicit <c>AllowAnonymous</c> opens an address; <see cref="UnmatchedRequestsPass"/> in place of
  /// ASP.NET's authorization result handler. <see cref="TimeProvider.System"/> unless one is registered. Called from
  /// Program.cs.
  /// </summary>
  public static IServiceCollection AddSignIn(this IServiceCollection services) {
    ArgumentNullException.ThrowIfNull(services);

    services.AddOptions<SignInOptions>()
      .BindConfiguration(SignInOptions.SECTION)
      .ValidateDataAnnotations()
      .ValidateOnStart();
    services.AddSingleton<IValidateOptions<SignInOptions>, SignInOptionsValidator>();
    // Parsed once, from settings the validator has already checked.
    services.AddSingleton(static provider => Allowlist.Parse(provider.GetRequiredService<IOptions<SignInOptions>>().Value.AllowedEmails));

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
        // The app never signs out at Microsoft (D2); left on, these default addresses would let another site sign the visitor out.
        options.RemoteSignOutPath = PathString.Empty;
        options.SignedOutCallbackPath = PathString.Empty;
        // The ID token's short claim names stay as they are, so the login holds "name" and "email".
        options.MapInboundClaims = false;
        options.Scope.Clear();

        foreach (string scope in _scopes)
          options.Scope.Add(scope);

        options.CorrelationCookie.Name = $"{SignInCookies.ROUND_TRIP_PREFIX}correlation.";
        options.NonceCookie.Name = $"{SignInCookies.ROUND_TRIP_PREFIX}nonce.";
        RoundTripCookie(options.CorrelationCookie);
        RoundTripCookie(options.NonceCookie);
        options.Events.OnTokenValidated = static context => {
          WarnOfARefusedAccount(context);

          return Task.CompletedTask;
        };
        options.Events.OnAccessDenied = static context => {
          ILogger logger = Logger(context.HttpContext);
          SignInLog.SignInCancelled(logger);

          return LandSignedOut(context);
        };
        options.Events.OnRemoteFailure = static context => {
          ILogger logger = Logger(context.HttpContext);
          string kind = FailureKind(context.Failure);
          SignInLog.SignInFailed(logger, kind);

          return LandSignedOut(context);
        };
      });

    services.AddOptions<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme)
      .Configure<IOptions<SignInOptions>>(static (options, settings) => {
        options.Authority = settings.Value.Authority.AbsoluteUri;
        options.ClientId = settings.Value.ClientId;
        options.ClientSecret = settings.Value.ClientSecret;
      });

    services.Configure<ProblemDetailsOptions>(static options => options.CustomizeProblemDetails += NameTheRefusedAccount);

    AuthorizationPolicy allowedUser = new AuthorizationPolicyBuilder()
      .RequireAuthenticatedUser()
      .AddRequirements(new AllowedUserRequirement())
      .Build();

    services.AddAuthorizationBuilder()
      .AddPolicy(ALLOWED_USER, allowedUser)
      .SetDefaultPolicy(allowedUser)
      .SetFallbackPolicy(allowedUser);
    services.AddSingleton<IAuthorizationHandler, AllowedUserHandler>();
    services.Replace(ServiceDescriptor.Singleton<IAuthorizationMiddlewareResultHandler, UnmatchedRequestsPass>());

    services.TryAddSingleton(TimeProvider.System);

    return services;
  }

  /// <summary>
  /// After <c>UseAppPages</c>, so the pages and their files need no sign-in, and before <c>UseFastEndpoints</c>:
  /// authentication, then authorization, then the rule against writes from other sites (D4). A refusal by authorization
  /// counts only for a request that matched an endpoint (<see cref="UnmatchedRequestsPass"/>, D3), so an address nothing
  /// serves answers 404 to everyone.
  /// </summary>
  public static WebApplication UseSignIn(this WebApplication app) {
    ArgumentNullException.ThrowIfNull(app);

    app.UseAuthentication();
    app.UseAuthorization();
    app.UseCrossSiteWriteProtection();

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

  /// <summary>
  /// At sign-in, once the ID token is valid: an account whose email address is missing or not on the allowlist is logged
  /// as <see cref="SignInLog.SignInRefused"/>, with its subject and never its email address (D3, D8). The sign-in goes on
  /// either way; the refusal happens on each request.
  /// </summary>
  private static void WarnOfARefusedAccount(TokenValidatedContext context) {
    ClaimsPrincipal? account = context.Principal;

    if (context.HttpContext.RequestServices.GetRequiredService<Allowlist>().Allows(account?.FindFirstValue(JwtRegisteredClaimNames.Email)))
      return;

    ILogger logger = Logger(context.HttpContext);
    string subject = account?.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? string.Empty;
    SignInLog.SignInRefused(logger, subject);
  }

  /// <summary>
  /// A sign-in that did not complete (cancelled, or failed) goes back to the start page, signed out (D3): the handler's own
  /// answer, an error page or an exception, is replaced by the redirect.
  /// </summary>
  private static Task LandSignedOut(HandleRequestContext<RemoteAuthenticationOptions> context) {
    context.Response.Redirect(SignInAddresses.LANDING);
    context.HandleResponse();

    return Task.CompletedTask;
  }

  /// <summary>
  /// A failed sign-in's kind (D3): Microsoft's error code when it answered with an error, in the shape of one; otherwise
  /// the exception's type. Never the exception's message, which may quote the token.
  /// </summary>
  private static string FailureKind(Exception? failure) {
    if (failure is null)
      return nameof(Exception);

    return failure.Data[ERROR_CODE] is string code && IsErrorCode(code) ? code : failure.GetType().Name;
  }

  /// <summary>
  /// Whether <paramref name="code"/> looks like an error code of OAuth 2.0 and OpenID Connect (<c>invalid_request</c>,
  /// <c>server_error</c>, …): lowercase letters and underscores, not too long. Anyone can post an answer to the return
  /// address, so a code is logged only in this shape, which can hold neither an email address nor a token.
  /// </summary>
  private static bool IsErrorCode(string code) => code.Length is > 0 and <= LONGEST_ERROR_CODE && code.All(static letter => letter is (>= 'a' and <= 'z') or '_');

  private static ILogger Logger(HttpContext context) => context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(LOG_CATEGORY);

  /// <summary>
  /// A 403 for a signed-in account names that account's own email address, as the extension <c>email</c> (D3), so the
  /// page can say which account has no access; without an email claim, the problem has no such extension.
  /// </summary>
  private static void NameTheRefusedAccount(ProblemDetailsContext context) {
    ClaimsPrincipal user = context.HttpContext.User;

    if (context.HttpContext.Response.StatusCode == StatusCodes.Status403Forbidden
        && user.Identity?.IsAuthenticated == true
        && user.FindFirstValue(JwtRegisteredClaimNames.Email) is { Length: > 0 } email)
      context.ProblemDetails.Extensions[EMAIL_EXTENSION] = email;
  }

  /// <summary>Answers the cookie handler's redirect with <paramref name="status"/> instead: no <c>Location</c>, no body.</summary>
  private static Task AnswerWithStatus(RedirectContext<CookieAuthenticationOptions> context, int status) {
    context.Response.StatusCode = status;

    return Task.CompletedTask;
  }
}