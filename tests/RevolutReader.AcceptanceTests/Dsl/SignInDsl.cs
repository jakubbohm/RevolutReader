using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Signing in, as the scenarios state it (spec sign-in, c007 design.md D6): the allowlist, a visitor's sign-in through
/// Microsoft, signing out, asking who is signed in, and time passing. One visitor per test, in one browser; every test
/// starts with nobody signed in.
/// <para>
/// The allowlist is fixed when the app copy starts (<see cref="FakeMicrosoft.ALLOWED_EMAILS"/>), so the allowlist steps set
/// nothing up. They check the app copy's configured list instead and throw when it does not match what the scenario
/// states, so a scenario never rests on an allowlist it only assumes.
/// </para>
/// </summary>
public sealed class SignInDsl(SignInDriver driver) {
  /// <summary>
  /// The page of another app on the same hosting domain that sends the sign-out in "A write request from another site is
  /// refused" (made up).
  /// </summary>
  private const string ANOTHER_APP_ON_THE_SAME_HOSTING_DOMAIN = "https://jina-appka.example.net";

  /// <summary>How the hosting proxy received the visitor's request.</summary>
  private const string HTTPS = "https";

  // The allowlist (GIVEN)

  /// <summary>Checks that <paramref name="email"/> is on the app copy's allowlist, ignoring case; throws otherwise.</summary>
  public void IsOnTheAllowlist(string email) {
    if (!OnTheAllowlist(email))
      throw new InvalidOperationException($"The scenario needs {email} on the allowlist, but the app copy's allowlist does not hold it (Drivers/FakeMicrosoft sets it when the app copy starts).");
  }

  /// <summary>Checks that <paramref name="email"/> is not on the app copy's allowlist, ignoring case; throws otherwise.</summary>
  public void IsNotOnTheAllowlist(string email) {
    if (OnTheAllowlist(email))
      throw new InvalidOperationException($"The scenario needs {email} off the allowlist, but the app copy's allowlist holds it (Drivers/FakeMicrosoft sets it when the app copy starts).");
  }

  // Signing in (GIVEN and WHEN)

  /// <summary>The visitor starts a sign-in and signs in at Microsoft with this account.</summary>
  public async Task<Landing> SignsIn(Visitor visitor) {
    await StartsSignIn();

    return await MicrosoftAnswersWith(visitor);
  }

  /// <summary>
  /// An allowed visitor is signed in: they sign in, and the API then names them; throws otherwise. A scenario whose outcome
  /// is "not signed in" starts from here, so a sign-in that never worked cannot make it pass.
  /// </summary>
  public async Task HasSignedIn(Visitor visitor) {
    _ = await SignsIn(visitor);

    WhoAnswer answer = await AsksWhoIsSignedIn();

    if (answer != WhoAnswer.SignedInAs(visitor))
      throw new InvalidOperationException($"The scenario needs {visitor} signed in, but asked who is signed in, the API answered {answer}.");
  }

  /// <summary>The visitor starts a sign-in (the app's sign-in button).</summary>
  public Task<SignInStart> StartsSignIn() => driver.StartSignIn(anotherAccount: false);

  /// <summary>The visitor starts a sign-in to try another account ("Zkusit jiný účet").</summary>
  public Task<SignInStart> StartsSignInToTryAnotherAccount() => driver.StartSignIn(anotherAccount: true);

  /// <summary>The visitor starts a sign-in through the hosting proxy, which received the request over HTTPS for <paramref name="host"/>.</summary>
  public Task<SignInStart> StartsSignInBehindProxy(string host) => driver.StartSignIn(anotherAccount: false, forwardedProto: HTTPS, host: host);

  /// <summary>Microsoft answers the started sign-in with this account, from the directory it belongs to.</summary>
  public Task<Landing> MicrosoftAnswersWith(Visitor visitor) {
    ArgumentNullException.ThrowIfNull(visitor);

    return driver.ReturnFromMicrosoft(visitor.FromWorkOrSchoolDirectory
      ? IdentityAtMicrosoft.WorkOrSchoolAccount(visitor.Name, visitor.Email)
      : IdentityAtMicrosoft.PersonalAccount(visitor.Name, visitor.Email));
  }

  /// <summary>Microsoft reports that the visitor cancelled the started sign-in.</summary>
  public Task<Landing> CancelsAtMicrosoft() => driver.CancelAtMicrosoft();

  // Using the app (WHEN)

  /// <summary>The visitor asks the API who is signed in.</summary>
  public Task<WhoAnswer> AsksWhoIsSignedIn() => driver.AskWhoIsSignedIn();

  /// <summary>The visitor uses the app: opening it asks the API who is signed in (D3), whatever the answer.</summary>
  public async Task UsesTheApp() => _ = await driver.AskWhoIsSignedIn();

  /// <summary>The visitor signs out from the app.</summary>
  public Task<SignOutAnswer> SignsOut() => driver.SignOut();

  /// <summary>A page of another app on the same hosting domain makes the visitor's browser send the sign-out request.</summary>
  public Task<SignOutAnswer> AnotherSiteSendsSignOut() => driver.SignOut(fromSite: ANOTHER_APP_ON_THE_SAME_HOSTING_DOMAIN);

  // Time (GIVEN)

  /// <summary>This many days pass on the app's clock. Only after signing in: Microsoft's token is checked against the real clock (D6).</summary>
  public void DaysPass(int days) => driver.Advance(TimeSpan.FromDays(days));

  private bool OnTheAllowlist(string email) => driver.AllowedEmails().Contains(email, StringComparer.OrdinalIgnoreCase);
}