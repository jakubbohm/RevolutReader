using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenTelemetry.Trace;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The signed-in account on the request telemetry (roadmap C14; ADR-0009-application-telemetry, Decision item 7): the
/// server activity of a request an allowed, signed-in user makes carries the account's email address in OpenTelemetry's
/// attribute for the signed-in user, <see cref="SIGNED_IN_USER"/>, which the Azure Monitor exporter writes to the request's
/// authenticated user (<c>UserAuthenticatedId</c>). The email goes on API requests only: the pages and files the app
/// serves carry no account (roadmap C14), no log line holds it (ADR-0004-account-allowlist, Decision item 7), and a
/// stranger's email is exported nowhere.
/// <para>
/// A rule, not a scenario: no public channel shows the telemetry. "Exported" is what OpenTelemetry's in-memory exporter
/// receives from the app's own tracing setup, with TUnit's own trace additions switched off, as in
/// <see cref="BankTelemetryTests"/>. The app copies of tests running in parallel export into this test's collection too
/// (<see cref="ExportedActivityCollection"/>), and many of them sign Lucie in: the first test finds Lucie's email on some server
/// activity, which only the app can have put there, and the stranger's email is one no app copy may export at all. The
/// logs are this app copy's alone (<see cref="CapturedLogTexts"/>).
/// </para>
/// <para>
/// A request's server activity is exported only after the client has the response, so each trace test waits for the
/// activity it asserts on. The first waits for one carrying Lucie's email
/// (<see cref="ExportedActivityCollection.WaitForServerActivity"/>): run alone, the only one is its own last request,
/// <c>GET /api/me</c>, which may still be ending when the sign-in returns. The second has the signed-in stranger ask an
/// API address no endpoint has, made up for this test: the catch-all that answers it is open to anyone, so authorization
/// lets the request through to the step that records the account (the refused <c>GET /api/me</c> never gets there). It
/// waits for that request's server activity (<see cref="ExportedActivityCollection.RequestsTo"/>) and fails when the
/// activity never arrives, so it cannot pass by looking too early. The page and file tests read their request's server
/// activity the same way, each at an address made up for it: a page address other than the start page, which the app's
/// page fallback answers after the sign-in step has run, and a file the app does not have, which no step answers before
/// it either.
/// </para>
/// </summary>
public sealed class RequestAccountTelemetryTests : AcceptanceTest {
  /// <summary>OpenTelemetry's attribute the Azure Monitor exporter (1.10.0) reads for a request's authenticated user.</summary>
  private const string SIGNED_IN_USER = "enduser.id";

  /// <summary>The start of an API address no endpoint has; a test adds a made-up segment, so the address is its own.</summary>
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address/";

  /// <summary>The start of a page address other than the start page; a test adds a made-up segment, so the address is its own.</summary>
  private const string PAGE_ADDRESS = "/no-such-page-";

  /// <summary>The start of the address of a file the app does not have; a test adds a made-up name and a file extension.</summary>
  private const string MISSING_FILE_ADDRESS = "/no-such-file-";

  private readonly CapturedLogTexts _logs = new();
  private readonly ExportedActivityCollection _traces = new();

  [Test]
  public async Task An_allowed_users_request_carries_the_accounts_email_as_its_signed_in_user() {
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);

    await SignIn.HasSignedIn(Visitor.Lucie);
    await _traces.WaitForServerActivity(static activity => activity.GetTagItem(SIGNED_IN_USER)?.ToString() == Visitor.Lucie.Email);

    _traces.ServerTagValues(SIGNED_IN_USER).ShouldContain(Visitor.Lucie.Email, "the signed-in users of the exported requests");
  }

  [Test]
  public async Task A_strangers_requests_export_no_email() {
    string unknownAddress = $"{UNKNOWN_API_ADDRESS}{Guid.NewGuid():N}";
    SignIn.IsNotOnTheAllowlist(Visitor.Stranger.Email);

    await SignIn.SignsIn(Visitor.Stranger);
    (await SignIn.AsksWhoIsSignedIn()).Refused.ShouldBeTrue("the stranger is signed in and refused");
    (await SignInDriver.AskApiAddress(unknownAddress)).ShouldBe(ProblemDescription.NotFound, "the signed-in stranger asks an address no endpoint has");

    (await _traces.RequestsTo(unknownAddress)).ShouldHaveSingleItem("the exported requests to the address only this test asks");
    _traces.Texts().Where(static text => text.Contains(Visitor.Stranger.Email, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("Exported trace names, tags, events or statuses naming the stranger's email");
  }

  [Test]
  public async Task An_allowed_users_page_request_carries_no_account() {
    string page = $"{PAGE_ADDRESS}{Guid.NewGuid():N}";
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);

    await SignIn.HasSignedIn(Visitor.Lucie);
    (await SignInDriver.OpenPageAddress(page)).ShouldBe(PageAnswer.TheApp, "the signed-in user opens a page address other than the start page");

    (await _traces.RequestsTo(page)).ShouldHaveSingleItem("the exported requests to the page address only this test opens")
      .GetTagItem(SIGNED_IN_USER).ShouldBeNull("the signed-in user recorded on the page request");
  }

  [Test]
  public async Task An_allowed_users_request_for_a_missing_file_carries_no_account() {
    string file = $"{MISSING_FILE_ADDRESS}{Guid.NewGuid():N}.js";
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);

    await SignIn.HasSignedIn(Visitor.Lucie);
    (await SignInDriver.OpenPageAddress(file)).ShouldNotBe(PageAnswer.TheApp, "the signed-in user's browser asks for a file the app does not have");

    (await _traces.RequestsTo(file)).ShouldHaveSingleItem("the exported requests to the file address only this test asks")
      .GetTagItem(SIGNED_IN_USER).ShouldBeNull("the signed-in user recorded on the request for the missing file");
  }

  [Test]
  public async Task An_allowed_users_requests_leave_no_email_in_log_lines() {
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);

    await SignIn.HasSignedIn(Visitor.Lucie);
    await SignIn.UsesTheApp();

    _logs.Texts().Where(static text => text.Contains(Visitor.Lucie.Email, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("Log messages, structured values or scope values naming the allowed user's email");
  }

  protected override void ConfigureTestOptions(WebApplicationTestOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    options.AutoConfigureOpenTelemetry = false;
    options.AutoPropagateHttpClientFactory = false;
  }

  protected override void ConfigureTestServices(IServiceCollection services) {
    services.AddSingleton<ILoggerProvider>(_ => _logs.Provider());
    services.ConfigureOpenTelemetryTracerProvider(tracing => tracing.AddInMemoryExporter(_traces));
  }
}