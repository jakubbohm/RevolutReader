using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A request carrying <c>Sec-Fetch-Site</c> or <c>Origin</c> more than once (some clients and proxies send a header twice)
/// is refused only where the rule against writes from other sites applies (c007 design.md D4): a POST, PUT, PATCH or
/// DELETE under <c>/api</c>. There such a request is ambiguous, so it is refused; everywhere else the rule does not look at
/// it, and the request answers as it would without the extra line (a read passes whatever its headers, task 13.1). Each
/// header goes on two separate lines, so the app sees two values. A rule, not a scenario.
/// </summary>
public sealed class RepeatedHeadersTests : AcceptanceTest {
  private const string ORIGIN = "Origin";
  private const string SEC_FETCH_SITE = "Sec-Fetch-Site";

  /// <summary>The test browser's own origin, and a site that has nothing to do with the app (made up).</summary>
  private const string APP = "https://localhost";
  private const string OTHER_SITE = "https://cizi-web.example.org";

  [Test]
  public async Task A_health_check_with_a_repeated_Origin_header_answers_as_usual() =>
    (await HealthDriver.GetHealthWithHeaderLines(ORIGIN, APP, OTHER_SITE)).ShouldBe(HealthAnswer.Healthy);

  /// <summary>
  /// Signed in, so the read gets past authorization, which runs before the rule (D4's placement): an anonymous read is
  /// answered 401 there whatever its headers, so it could not show what the rule does.
  /// </summary>
  [Test]
  public async Task A_read_under_api_with_a_repeated_Sec_Fetch_Site_header_gets_its_usual_answer_not_the_write_rules_refusal() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await SignInDriver.AskWhoIsSignedInWithHeaderLines(SEC_FETCH_SITE, "same-origin", "cross-site"))
      .ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie), "Lucie's name and email, as without the extra line");
  }

  /// <summary>Passes today; it pins that a fix for reads keeps the refusal for writes.</summary>
  [Test]
  public async Task A_write_under_api_with_a_repeated_Origin_header_is_refused_and_changes_nothing() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await SignInDriver.SignOutWithHeaderLines(ORIGIN, APP, OTHER_SITE)).ShouldBe(SignOutAnswer.Refused);
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie), "Lucie is still signed in");
  }
}