using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.JsonWebTokens;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// Meets <see cref="AllowedUserRequirement"/> when the login's <c>email</c> claim is on the allowlist, ignoring case
/// (c007 design.md D3, D8). Checked on every request against the list the app started with; a login without an email
/// address is not allowed.
/// </summary>
public sealed class AllowedUserHandler(Allowlist allowlist) : AuthorizationHandler<AllowedUserRequirement> {
  protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, AllowedUserRequirement requirement) {
    ArgumentNullException.ThrowIfNull(context);

    if (allowlist.Allows(context.User.FindFirstValue(JwtRegisteredClaimNames.Email)))
      context.Succeed(requirement);

    return Task.CompletedTask;
  }
}