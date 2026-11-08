using FastEndpoints;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// <c>POST /api/auth/logout</c> (spec sign-in, c007 design.md D2): ends the login on this device by signing out of the
/// cookie scheme only, so the login cookie is deleted and the visitor's Microsoft account stays signed in. Anonymous: a
/// refused stranger must be able to sign out ("Zkusit jiný účet"), and signing out without a login is harmless. 204.
/// </summary>
public sealed class LogoutEndpoint : EndpointWithoutRequest {
  public override void Configure() {
    Post(SignInAddresses.LOGOUT);
    AllowAnonymous();
    Description(static endpoint => endpoint.Produces(StatusCodes.Status204NoContent), clearDefaults: true);
    Summary(static summary => summary.Summary = "Ends the sign-in on this device");
  }

  public override async Task HandleAsync(CancellationToken ct) {
    await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    await Send.NoContentAsync(ct);
  }
}