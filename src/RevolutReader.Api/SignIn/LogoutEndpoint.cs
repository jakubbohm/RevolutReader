using FastEndpoints;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// <c>POST /api/auth/logout</c> (spec sign-in, c007 design.md D2): ends the login on this device by signing out of the
/// cookie scheme only, so the login cookie is deleted and the visitor's Microsoft account stays signed in. Anonymous: a
/// refused stranger must be able to sign out ("Zkusit jiný účet"), and signing out without a login is harmless. 204; a
/// sign-out sent from another site is refused with 403 before it gets here (<c>UseCrossSiteWriteProtection</c>, D4).
/// </summary>
public sealed class LogoutEndpoint : EndpointWithoutRequest {
  public override void Configure() {
    Post(SignInAddresses.LOGOUT);
    AllowAnonymous();
    // 403: refused by the rule against writes from other sites (D4).
    Description(static endpoint => endpoint.Produces(StatusCodes.Status204NoContent).ProducesProblem(StatusCodes.Status403Forbidden), clearDefaults: true);
    Summary(static summary => summary.Summary = "Ends the sign-in on this device");
  }

  public override async Task HandleAsync(CancellationToken ct) {
    await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    await Send.NoContentAsync(ct);
  }
}