using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.SignIn;

public sealed class SignInScenarios : AcceptanceTest {
  [Test, Scenario("sign-in", "An anonymous visitor is asked to sign in")]
  public async Task An_anonymous_visitor_is_asked_to_sign_in() => (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn);

  [Test, Scenario("sign-in", "An allowed user who signs in gets in")]
  public async Task An_allowed_user_who_signs_in_gets_in() {
    SignIn.IsOnTheAllowlist("lucie@example.com");

    (await SignIn.SignsIn(Visitor.Lucie)).ShouldBe(Landing.StartPage);
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs("Lucie Nováková", "lucie@example.com"));
  }

  [Test, Scenario("sign-in", "A stranger who signs in is refused, with their own email")]
  public async Task A_stranger_who_signs_in_is_refused_with_their_own_email() {
    SignIn.IsNotOnTheAllowlist("cizi.ucet@example.com");

    await SignIn.SignsIn(Visitor.Stranger);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.RefusedNaming("cizi.ucet@example.com"));
  }

  [Test, Scenario("sign-in", "Signing out ends the login")]
  public async Task Signing_out_ends_the_login() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    await SignIn.SignsOut();

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn);
  }

  [Test, Scenario("sign-in", "A write request from another site is refused")]
  public async Task A_write_request_from_another_site_is_refused() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await SignIn.AnotherSiteSendsSignOut()).ShouldBe(SignOutAnswer.Refused);
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie));
  }

  [Test, Scenario("sign-in", "Sign-in returns to the app's own HTTPS address behind the hosting proxy")]
  public async Task Sign_in_returns_to_the_apps_own_HTTPS_address_behind_the_hosting_proxy() =>
    (await SignIn.StartsSignInBehindProxy("tarjeta.example.net")).ReturnAddress.ShouldBe(new Uri("https://tarjeta.example.net/api/auth/signin-oidc"));

  [Test, Scenario("sign-in", "Signing in again with another account opens Microsoft's account picker")]
  public async Task Signing_in_again_with_another_account_opens_Microsofts_account_picker() {
    SignInStart start = await SignIn.StartsSignInToTryAnotherAccount();

    start.SentToMicrosoft.ShouldBeTrue("sent to Microsoft's sign-in");
    start.AccountPickerAsked.ShouldBeTrue("Microsoft is asked to show its account picker");
  }

  [Test, Scenario("sign-in", "A sign-in cancelled at Microsoft leaves the visitor signed out")]
  public async Task A_sign_in_cancelled_at_Microsoft_leaves_the_visitor_signed_out() {
    await SignIn.StartsSignIn();

    (await SignIn.CancelsAtMicrosoft()).ShouldBe(Landing.StartPage);
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn);
  }

  [Test, Scenario("sign-in", "An account from a work or school directory is not signed in")]
  public async Task An_account_from_a_work_or_school_directory_is_not_signed_in() {
    await SignIn.StartsSignIn();

    (await SignIn.MicrosoftAnswersWith(Visitor.WorkAccount)).ShouldBe(Landing.StartPage);
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn);
  }

  [Test, Scenario("sign-in", "A login unused for 30 days has ended")]
  public async Task A_login_unused_for_30_days_has_ended() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    SignIn.DaysPass(31);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn);
  }

  [Test, Scenario("sign-in", "Using the app keeps the login alive")]
  public async Task Using_the_app_keeps_the_login_alive() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    SignIn.DaysPass(20);
    await SignIn.UsesTheApp();
    SignIn.DaysPass(45 - 20);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie));
  }
}