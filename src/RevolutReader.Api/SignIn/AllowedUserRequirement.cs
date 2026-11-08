using Microsoft.AspNetCore.Authorization;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The <c>AllowedUser</c> policy's own requirement, next to "signed in" (c007 design.md D3): the account's email address is
/// on the allowlist. Met by <see cref="AllowedUserHandler"/>; a signed-in account that does not meet it gets 403.
/// </summary>
public sealed class AllowedUserRequirement : IAuthorizationRequirement;