using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Walks the real sign-in round trip against the test's app copy and <see cref="FakeMicrosoft"/> (spec sign-in, c007
/// design.md D6), as a browser does, with its own <see cref="HttpClient"/> (<see cref="BrowserOptions"/>): base address
/// <c>https://localhost</c>, so the <c>Secure</c> cookies flow (the test server takes the scheme from the address); no
/// automatic redirects, so each step reads the app's answer; cookies kept between steps. It remembers the sign-in it
/// started (<c>state</c>, <c>nonce</c>, the return address), so test cases pass nothing between steps. Status codes,
/// headers and addresses stay here; the DSL gets <see cref="SignInStart"/>, <see cref="Landing"/>,
/// <see cref="WhoAnswer"/> and <see cref="SignOutAnswer"/>.
/// <para>
/// Filled in by the wiring groups (tasks 2.2, 5.4, 11.1, 14.1, 16.1, 18.1, 20.1, 24.1); until then every method that
/// talks to the app throws. <see cref="AllowedEmails"/> reads only the app copy's configuration, so it works already.
/// </para>
/// </summary>
public sealed class SignInDriver(HttpClient browser, FakeMicrosoft microsoft, IServiceProvider services) {
  /// <summary>The app copy's allowlist setting (c007 design.md D8): comma-separated addresses.</summary>
  private const string ALLOWLIST_SETTING = "SignIn:AllowedEmails";

  /// <summary>The browser's client options: the app's own HTTPS address, no automatic redirects, cookies kept.</summary>
  public static WebApplicationFactoryClientOptions BrowserOptions => new() {
    BaseAddress = new Uri("https://localhost"),
    AllowAutoRedirect = false,
    HandleCookies = true,
  };

  /// <summary>The browser: its cookies are the visitor's login.</summary>
  private HttpClient Browser => browser;

  /// <summary>The fake Microsoft the app copy signs in through; its <see cref="FakeMicrosoft.Clock"/> is the app copy's clock.</summary>
  private FakeMicrosoft Microsoft => microsoft;

  /// <summary>
  /// The app copy's allowlist as it was configured at start (<c>SignIn:AllowedEmails</c>, D8): split on commas, entries
  /// trimmed, empty entries left out. Read from the app copy's configuration, never from the app's own parsing.
  /// </summary>
  public IReadOnlyList<string> AllowedEmails() {
    string? value = services.GetRequiredService<IConfiguration>()[ALLOWLIST_SETTING];

    return value is null ? [] : [.. value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)];
  }

  /// <summary>
  /// <c>GET /api/auth/login</c>, with <c>?anotherAccount=true</c> when <paramref name="anotherAccount"/> (D2). Behind the
  /// hosting proxy (<paramref name="host"/> given), the request reaches the app as the ingress forwards it (D10): over
  /// plain HTTP, for <paramref name="host"/>, with <c>X-Forwarded-Proto: </c><paramref name="forwardedProto"/>; so only
  /// the forwarded headers can make the return address HTTPS. From the redirect it reads: whether it goes to the fake
  /// Microsoft's authorize endpoint (<see cref="SignInStart.SentToMicrosoft"/>), <c>redirect_uri</c>
  /// (<see cref="SignInStart.ReturnAddress"/>) and <c>prompt=select_account</c> (<see cref="SignInStart.AccountPickerAsked"/>);
  /// it keeps <c>state</c>, <c>nonce</c> and the return address for the next step.
  /// </summary>
  public Task<SignInStart> StartSignIn(bool anotherAccount, string? forwardedProto = null, string? host = null) => throw new NotImplementedException();

  /// <summary>
  /// Microsoft signs <paramref name="identity"/> in: the fake Microsoft gets the ID token for it and the started sign-in's
  /// nonce (<see cref="FakeMicrosoft.AnswerToken"/>); then the browser posts a made-up <c>code</c> and the <c>state</c> to
  /// the return address, as a browser does after Microsoft's page (D6): <c>Sec-Fetch-Site: cross-site</c>,
  /// <c>Origin: https://login.microsoftonline.com</c>, <c>Content-Type: application/x-www-form-urlencoded</c>. It follows
  /// the app's redirects on its own address; <see cref="Landing.StartPage"/> when they end at <c>/</c> with the app's page
  /// (as <see cref="PagesDriver"/> reads it).
  /// </summary>
  public Task<Landing> ReturnFromMicrosoft(IdentityAtMicrosoft identity) => throw new NotImplementedException();

  /// <summary>
  /// Microsoft reports that the visitor cancelled the started sign-in: the browser posts <c>error=access_denied</c> and the
  /// <c>state</c> to the return address, with the same cross-site headers as <see cref="ReturnFromMicrosoft"/>, and
  /// follows the app's redirects as it does.
  /// </summary>
  public Task<Landing> CancelAtMicrosoft() => throw new NotImplementedException();

  /// <summary>
  /// <c>GET /api/me</c> with the browser's cookies (D3), mapped as <see cref="WhoAnswer"/> describes. A problem
  /// description counts only with content type <c>application/problem+json</c>, a <c>status</c> equal to the response's and
  /// the title of its case (as <see cref="ApiDriver"/> reads one); the refused email is its <c>email</c> extension. The
  /// signed-in answer counts only as a JSON object with exactly the string properties <c>name</c> and <c>email</c>.
  /// </summary>
  public Task<WhoAnswer> AskWhoIsSignedIn() => throw new NotImplementedException();

  /// <summary>
  /// <c>POST /api/auth/logout</c> with the browser's cookies (D2), mapped as <see cref="SignOutAnswer"/> describes. Sent
  /// as the app's own page sends it (<c>Sec-Fetch-Site: same-origin</c>, <c>Origin</c> = the app's address); with
  /// <paramref name="fromSite"/>, as a page of another app on the same hosting domain makes the browser send it (D4):
  /// <c>Sec-Fetch-Site: same-site</c>, because the hosting domain is not on the Public Suffix List, and
  /// <c>Origin: </c><paramref name="fromSite"/>.
  /// </summary>
  public Task<SignOutAnswer> SignOut(string? fromSite = null) => throw new NotImplementedException();

  /// <summary>Moves the app copy's clock (<see cref="FakeMicrosoft.Clock"/>) forward by <paramref name="time"/>.</summary>
  public void Advance(TimeSpan time) => throw new NotImplementedException();
}