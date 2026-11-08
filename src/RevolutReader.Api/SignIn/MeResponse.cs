using System.ComponentModel;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// Who is signed in (spec sign-in, c007 design.md D3): exactly the name and the email address the Microsoft account gives,
/// and nothing else about the account. The descriptions are the API description's, in plain words.
/// </summary>
[Description("The signed-in user's name and email address")]
public sealed record MeResponse(
  [property: Description("The user's name, as their Microsoft account gives it")] string Name,
  [property: Description("The user's email address, as their Microsoft account gives it")] string Email);