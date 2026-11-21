using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A report of a push's arrival never renews the login (c016 design.md D3, "A report never renews the login", added at the
/// review of PR #92, finding 3), so sign-in's requirement "The login lasts 30 days and is renewed while the app is used"
/// holds for a phone that only receives pushes: a login unused for 30 days has ended, however many reports the phone sent.
/// The login slides (c007: 30 days, renewed by a request once half of them has passed), and a report is a request with the
/// login that the service worker sends while nobody uses the app.
/// <para>
/// Lucie signs in; on day 20, past the half where a request of the app renews the login (sign-in's "Using the app keeps the
/// login alive"), her phone reports one arrival, which is accepted, so the login still held; on day 31, past 30 days from
/// the sign-in but within 30 days of the report, the API asks her to sign in. The same timeline without the report is
/// sign-in's "A login unused for 30 days has ended", so only a renewal by the report can keep her signed in here. The test
/// browser keeps every cookie the app sends, a renewed login too.
/// </para>
/// A rule, not a scenario (design.md D3).
/// </summary>
public sealed class PushArrivalLoginTests : AcceptanceTest {
  [Test]
  public async Task A_report_never_renews_the_login() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    SignIn.DaysPass(20);

    (await Arrivals.PhoneReportsAPushReadEarlier(TimeSpan.FromSeconds(2))).ShouldBe(ReportAnswer.Accepted, "the phone's report on day 20");
    SignIn.DaysPass(31 - 20);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn, "on day 31, the app unused since the sign-in");
  }
}