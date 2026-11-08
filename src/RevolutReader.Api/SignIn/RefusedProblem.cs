using System.ComponentModel;
using Microsoft.AspNetCore.Mvc;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The 403 problem description's shape in the API description (c007 design.md D3, D9): ASP.NET's problem description plus
/// the extension <c>email</c>, which the problem details customization in <see cref="SignInRegistration"/> adds for an
/// account the allowlist refuses. Never built by the app: the problem details service writes the answer.
/// </summary>
[Description("A problem description that refuses a signed-in account, naming its own email address")]
public sealed class RefusedProblem : ProblemDetails {
  [Description("The refused account's own email address; missing when the account has none")]
  public string? Email { get; init; }
}