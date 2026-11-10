namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Someone who signs in through Microsoft (spec sign-in, c007 design.md D6): the name and email address their Microsoft
/// account gives, and whether a work or school directory issued it instead of the personal-account service. A visitor who
/// has not signed in needs no value: it is the state every test starts in.
/// </summary>
public sealed record Visitor(string Name, string Email, bool FromWorkOrSchoolDirectory = false) {
  /// <summary>An allowed user, with a personal account: on the harness's allowlist (<see cref="Drivers.FakeMicrosoft.ALLOWED_EMAILS"/>).</summary>
  public static Visitor Lucie { get; } = new("Lucie Nováková", "lucie@example.com");

  /// <summary>
  /// A second allowed user, with a personal account, also on the harness's allowlist: for the scenarios that need two
  /// allowed accounts (specs push-devices, push-sending; c011 design.md D7). Made up, as Lucie is.
  /// </summary>
  public static Visitor Petr { get; } = new("Petr Novák", "petr@example.com");

  /// <summary>A signed-in stranger, with a personal account that is not on the allowlist.</summary>
  public static Visitor Stranger { get; } = new("Karel Cizí", "cizi.ucet@example.com");

  /// <summary>
  /// An account from a work or school directory, with Lucie's name and allowed address, so only the directory can keep it
  /// out: a missing issuer check would let it in (or, with any other address, refuse it with 403 instead of not signing it in).
  /// </summary>
  public static Visitor WorkAccount { get; } = new("Lucie Nováková", "lucie@example.com", FromWorkOrSchoolDirectory: true);
}