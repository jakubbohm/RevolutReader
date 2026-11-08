using FastEndpoints;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// <c>GET /api/auth/login[?anotherAccount=true]</c> (spec sign-in, c007 design.md D2): starts a sign-in by challenging
/// OpenID Connect, which sends the visitor to Microsoft; with <see cref="LoginRequest.AnotherAccount"/>, Microsoft is sent
/// <c>prompt=select_account</c> and shows its account picker. Anonymous, because the visitor has no login yet. The
/// challenge's properties travel to Microsoft and back and become the login's: afterwards the visitor always lands on
/// <c>/</c> (there is no return-address parameter, so nothing to redirect elsewhere), and the login is persistent, so
/// closing the app keeps it (D4).
/// </summary>
public sealed class LoginEndpoint : Endpoint<LoginRequest> {
  /// <summary>Where every sign-in returns to: the app's start page.</summary>
  private const string START_PAGE = "/";

  /// <summary>The OpenID Connect <c>prompt</c> that makes Microsoft show its account picker.</summary>
  private const string SELECT_ACCOUNT = "select_account";

  public override void Configure() {
    Get(SignInAddresses.LOGIN);
    AllowAnonymous();
    Description(static endpoint => endpoint.Produces(StatusCodes.Status302Found), clearDefaults: true);
    Summary(static summary => {
      summary.Summary = "Starts the sign-in at Microsoft";
      summary.Params[nameof(LoginRequest.AnotherAccount)] = "Asks Microsoft to show its account picker";
    });
  }

  public override Task HandleAsync(LoginRequest req, CancellationToken ct) {
    ArgumentNullException.ThrowIfNull(req);

    OpenIdConnectChallengeProperties login = new() {
      RedirectUri = START_PAGE,
      IsPersistent = true,
      Prompt = req.AnotherAccount is true ? SELECT_ACCOUNT : null,
    };

    return Send.ResultAsync(TypedResults.Challenge(login, [OpenIdConnectDefaults.AuthenticationScheme]));
  }
}