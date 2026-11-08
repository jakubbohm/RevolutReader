namespace RevolutReader.Api.SignIn;

/// <summary>
/// Who is signed in (spec sign-in, c007 design.md D3): exactly the name and the email address the Microsoft account gives,
/// and nothing else about the account.
/// </summary>
public sealed record MeResponse(string Name, string Email);