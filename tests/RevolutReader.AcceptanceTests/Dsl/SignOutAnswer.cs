namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the API answered a sign-out (spec sign-in, c007 design.md D2, D4). The driver
/// (<see cref="Drivers.SignInDriver.SignOut"/>) gives <see cref="SignedOut"/> for a success without content (204) and
/// <see cref="Refused"/> for a problem description titled <c>Forbidden</c> (403). <see cref="SomethingElse"/> is the
/// default value, so an unset answer never reads as either.
/// </summary>
public enum SignOutAnswer {
  SomethingElse,
  SignedOut,
  Refused,
}