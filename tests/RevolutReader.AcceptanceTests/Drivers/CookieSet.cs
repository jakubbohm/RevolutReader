namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// One cookie an answer of the app set, as its <c>Set-Cookie</c> header says (c007 design.md D4): the name, the attributes,
/// and how long the browser keeps it, counted from the app copy's clock (<see cref="FakeMicrosoft.Clock"/>) when the answer
/// came; <see langword="null"/> for a cookie without an expiry, which the browser drops when it closes. A missing Path or
/// Domain is <see langword="null"/>; <see cref="SameSite"/> is <c>None</c>, <c>Lax</c>, <c>Strict</c> or <c>Unspecified</c>.
/// </summary>
public sealed record CookieSet(string Name, string? Path, string? Domain, bool Secure, bool HttpOnly, string SameSite, TimeSpan? Lifetime);