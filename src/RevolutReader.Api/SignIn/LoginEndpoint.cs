using FastEndpoints;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// <c>GET /api/auth/login</c> (spec sign-in, c007 design.md D2): starts a sign-in by challenging OpenID Connect, which
/// sends the visitor to Microsoft. Anonymous, because the visitor has no login yet. The challenge's properties travel to
/// Microsoft and back and become the login's: afterwards the visitor always lands on <c>/</c> (there is no return-address
/// parameter, so nothing to redirect elsewhere), and the login is persistent, so closing the app keeps it (D4).
/// </summary>
public sealed class LoginEndpoint : EndpointWithoutRequest {
  /// <summary>Where every sign-in returns to: the app's start page.</summary>
  private const string START_PAGE = "/";

  public override void Configure() {
    Get(SignInAddresses.LOGIN);
    AllowAnonymous();
  }

  public override Task HandleAsync(CancellationToken ct) {
    AuthenticationProperties login = new() {
      RedirectUri = START_PAGE,
      IsPersistent = true,
    };

    return Send.ResultAsync(TypedResults.Challenge(login, [OpenIdConnectDefaults.AuthenticationScheme]));
  }
}