namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the API answered when asked who is signed in (spec sign-in, c007 design.md D3). The driver
/// (<see cref="Drivers.SignInDriver.AskWhoIsSignedIn"/>) sets at most one kind, and only when the answer is exactly it:
/// <list type="bullet">
/// <item><see cref="SignInAsked"/>: a problem description titled <c>Unauthorized</c> (401).</item>
/// <item><see cref="Refused"/>: a problem description titled <c>Forbidden</c> (403), with the email address it names as
/// <see cref="RefusedEmail"/>, <see langword="null"/> when it names none.</item>
/// <item><see cref="Name"/> and <see cref="Email"/>: the signed-in user's, when the answer holds exactly these two and
/// nothing else (the exact shape, docs/conventions/README.md § Backend code).</item>
/// </list>
/// Any other answer is <see cref="SomethingElse"/>.
/// </summary>
public sealed record WhoAnswer(bool SignInAsked, bool Refused, string? RefusedEmail, string? Name, string? Email) {
  /// <summary>Nobody is signed in: the visitor is asked to sign in.</summary>
  public static WhoAnswer AskedToSignIn { get; } = new(true, false, null, null, null);

  /// <summary>Not an answer the API gives on purpose.</summary>
  public static WhoAnswer SomethingElse { get; } = new(false, false, null, null, null);

  /// <summary>The signed-in account is refused, and the answer names this email address (<see langword="null"/>: none).</summary>
  public static WhoAnswer RefusedNaming(string? email) => new(false, true, email, null, null);

  /// <summary>The signed-in user is allowed, and the answer is exactly their name and email address.</summary>
  public static WhoAnswer SignedInAs(string name, string email) => new(false, false, null, name, email);

  /// <summary>The signed-in user is allowed, and the answer is exactly this visitor's name and email address.</summary>
  public static WhoAnswer SignedInAs(Visitor visitor) {
    ArgumentNullException.ThrowIfNull(visitor);

    return SignedInAs(visitor.Name, visitor.Email);
  }
}