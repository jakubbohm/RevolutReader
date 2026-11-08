using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
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

  /// <summary>Who is signed in (D3).</summary>
  private const string ME = "/api/me";

  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The problem descriptions' titles of the cases 401 and 403 (case → status table, docs/conventions/README.md).</summary>
  private const string UNAUTHORIZED = "Unauthorized";
  private const string FORBIDDEN = "Forbidden";

  /// <summary>The JSON properties the driver reads: the problem description's, and the answer's and the refusal's.</summary>
  private const string STATUS = "status";
  private const string TITLE = "title";
  private const string NAME = "name";
  private const string EMAIL = "email";

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
  public async Task<WhoAnswer> AskWhoIsSignedIn() {
    using HttpRequestMessage request = new(HttpMethod.Get, new Uri(ME, UriKind.Relative));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(JSON));

    using HttpResponseMessage response = await Browser.SendAsync(request);

    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;

    if (JsonObjectOrNull(await response.Content.ReadAsStringAsync()) is not JsonElement body)
      return WhoAnswer.SomethingElse;

    return response.StatusCode switch {
      HttpStatusCode.Unauthorized when IsProblem(mediaType, body, response.StatusCode, UNAUTHORIZED) => WhoAnswer.AskedToSignIn,
      HttpStatusCode.Forbidden when IsProblem(mediaType, body, response.StatusCode, FORBIDDEN) => RefusedAnswer(body),
      HttpStatusCode.OK when IsMediaType(mediaType, JSON) => SignedInAnswer(body),
      _ => WhoAnswer.SomethingElse,
    };
  }

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

  /// <summary>The body as a JSON object, detached from its document; <see langword="null"/> when it is not one.</summary>
  private static JsonElement? JsonObjectOrNull(string body) {
    try {
      using JsonDocument document = JsonDocument.Parse(body);

      return document.RootElement.ValueKind == JsonValueKind.Object ? document.RootElement.Clone() : null;
    }
    catch (JsonException) {
      return null;
    }
  }

  /// <summary>Whether <paramref name="mediaType"/> is <paramref name="expected"/>, ignoring case; a parameter such as <c>charset</c> is not part of it.</summary>
  private static bool IsMediaType(string mediaType, string expected) => string.Equals(mediaType, expected, StringComparison.OrdinalIgnoreCase);

  /// <summary>
  /// Whether the answer is the problem description of its case (spec api-errors, as <see cref="ApiDriver"/> reads one):
  /// content type <c>application/problem+json</c>, a <c>status</c> equal to the response's, and <paramref name="title"/>.
  /// </summary>
  private static bool IsProblem(string mediaType, JsonElement body, HttpStatusCode status, string title) =>
    IsMediaType(mediaType, PROBLEM_JSON)
    && body.TryGetProperty(STATUS, out JsonElement bodyStatus)
    && bodyStatus.ValueKind == JsonValueKind.Number
    && bodyStatus.TryGetInt32(out int value)
    && value == (int)status
    && body.TryGetProperty(TITLE, out JsonElement bodyTitle)
    && bodyTitle.ValueKind == JsonValueKind.String
    && string.Equals(bodyTitle.GetString(), title, StringComparison.Ordinal);

  /// <summary>
  /// Refused, naming the problem's <c>email</c> extension; naming none when it has no such extension (D3). An <c>email</c>
  /// that is not a string is not an answer the API gives: <see cref="WhoAnswer.SomethingElse"/>.
  /// </summary>
  private static WhoAnswer RefusedAnswer(JsonElement problem) {
    if (!problem.TryGetProperty(EMAIL, out JsonElement email))
      return WhoAnswer.RefusedNaming(null);

    return email.ValueKind == JsonValueKind.String ? WhoAnswer.RefusedNaming(email.GetString()) : WhoAnswer.SomethingElse;
  }

  /// <summary>Signed in, when the object holds exactly the string properties <c>name</c> and <c>email</c> and nothing else (the exact shape).</summary>
  private static WhoAnswer SignedInAnswer(JsonElement body) {
    if (body.EnumerateObject().Count() != 2)
      return WhoAnswer.SomethingElse;

    if (!body.TryGetProperty(NAME, out JsonElement name) || name.ValueKind != JsonValueKind.String)
      return WhoAnswer.SomethingElse;

    if (!body.TryGetProperty(EMAIL, out JsonElement email) || email.ValueKind != JsonValueKind.String)
      return WhoAnswer.SomethingElse;

    return WhoAnswer.SignedInAs(name.GetString()!, email.GetString()!);
  }
}