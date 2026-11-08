using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;
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

  /// <summary>Sign-in's start (D2), and its query for trying another account.</summary>
  private const string LOGIN = "/api/auth/login";
  private const string ANOTHER_ACCOUNT = "?anotherAccount=true";

  /// <summary>Signing out (D2).</summary>
  private const string LOGOUT = "/api/auth/logout";

  /// <summary>Where every sign-in lands (D2).</summary>
  private const string START_PAGE = "/";

  /// <summary>The header the hosting proxy adds (D10).</summary>
  private const string X_FORWARDED_PROTO = "X-Forwarded-Proto";

  /// <summary>The authorize request's parameters the driver reads (OpenID Connect).</summary>
  private const string STATE = "state";
  private const string NONCE = "nonce";
  private const string REDIRECT_URI = "redirect_uri";
  private const string PROMPT = "prompt";
  private const string SELECT_ACCOUNT = "select_account";

  /// <summary>Microsoft's answer to the return address (<c>form_post</c>): a made-up code, which the fake Microsoft takes as it is.</summary>
  private const string CODE = "code";
  private const string AUTHORIZATION_CODE = "made-up-authorization-code";

  /// <summary>Microsoft's answer when the visitor cancels at its page (OAuth 2.0's error response).</summary>
  private const string ERROR = "error";
  private const string ACCESS_DENIED = "access_denied";
  private const string ERROR_DESCRIPTION = "error_description";

  /// <summary>How the browser marks a request made by a page of Microsoft's (D6): fetch metadata and the origin.</summary>
  private const string SEC_FETCH_SITE = "Sec-Fetch-Site";
  private const string CROSS_SITE = "cross-site";
  private const string ORIGIN = "Origin";
  private const string MICROSOFTS_PAGES = "https://login.microsoftonline.com";

  /// <summary>The rest of the fetch metadata a browser sends, for the requests other sites make it send (D4).</summary>
  private const string SEC_FETCH_MODE = "Sec-Fetch-Mode";
  private const string SEC_FETCH_DEST = "Sec-Fetch-Dest";
  private const string SAME_SITE = "same-site";
  private const string SAME_ORIGIN = "same-origin";
  private const string NO_CORS = "no-cors";
  private const string IMAGE = "image";
  private const string NAVIGATE = "navigate";
  private const string DOCUMENT = "document";

  /// <summary>A page of a site that has nothing to do with the app (made up), for a cross-site form post.</summary>
  private const string ANOTHER_SITES_PAGE = "https://cizi-web.example.org";

  private const string SET_COOKIE = "Set-Cookie";

  /// <summary>More redirects than any answer of the app needs; a longer chain counts as not landing.</summary>
  private const int MOST_REDIRECTS = 5;

  /// <summary>The app's own address, as the browser reaches it.</summary>
  private static readonly Uri _appAddress = new("https://localhost");

  /// <summary>The sign-in <see cref="StartSignIn"/> started, for the step that answers it; <see langword="null"/> before.</summary>
  private StartedSignIn? _started;

  /// <summary>The cookies the last sign-in start set (<see cref="CookiesSetByTheStart"/>).</summary>
  private IReadOnlyList<CookieSet> _setByTheStart = [];

  /// <summary>The cookies the last answer from Microsoft's page made the app set (<see cref="CookiesSetByTheReturn"/>).</summary>
  private IReadOnlyList<CookieSet> _setByTheReturn = [];

  /// <summary>The browser's client options: the app's own HTTPS address, no automatic redirects, cookies kept.</summary>
  public static WebApplicationFactoryClientOptions BrowserOptions => new() {
    BaseAddress = _appAddress,
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
  public async Task<SignInStart> StartSignIn(bool anotherAccount, string? forwardedProto = null, string? host = null) {
    _started = null;

    string path = anotherAccount ? $"{LOGIN}{ANOTHER_ACCOUNT}" : LOGIN;
    using HttpRequestMessage request = new(HttpMethod.Get, host is null ? new Uri(path, UriKind.Relative) : new Uri($"http://{host}{path}"));

    if (forwardedProto is not null)
      request.Headers.Add(X_FORWARDED_PROTO, forwardedProto);

    using HttpResponseMessage response = await Browser.SendAsync(request);

    _setByTheStart = CookiesSet(response);

    if (!IsRedirect(response.StatusCode) || response.Headers.Location is not { IsAbsoluteUri: true } location || !IsAt(location, Microsoft.AuthorizeEndpoint))
      return new SignInStart(SentToMicrosoft: false, ReturnAddress: null, AccountPickerAsked: false);

    Dictionary<string, StringValues> query = QueryHelpers.ParseQuery(location.Query);
    Uri? returnAddress = Uri.TryCreate(Single(query, REDIRECT_URI), UriKind.Absolute, out Uri? address) ? address : null;

    if (returnAddress is not null && Single(query, STATE) is { Length: > 0 } state && Single(query, NONCE) is { Length: > 0 } nonce)
      _started = new StartedSignIn(state, nonce, returnAddress);

    return new SignInStart(SentToMicrosoft: true, returnAddress, AccountPickerAsked: Single(query, PROMPT) == SELECT_ACCOUNT);
  }

  /// <summary>
  /// Microsoft signs <paramref name="identity"/> in: the fake Microsoft gets the ID token for it and the started sign-in's
  /// nonce (<see cref="FakeMicrosoft.AnswerToken"/>); then the browser posts a made-up <c>code</c> and the <c>state</c> to
  /// the return address, as a browser does after Microsoft's page (D6): <c>Sec-Fetch-Site: cross-site</c>,
  /// <c>Origin: https://login.microsoftonline.com</c>, <c>Content-Type: application/x-www-form-urlencoded</c>. It follows
  /// the app's redirects on its own address; <see cref="Landing.StartPage"/> when they end at <c>/</c> with the app's page
  /// (as <see cref="PagesDriver"/> reads it).
  /// </summary>
  public async Task<Landing> ReturnFromMicrosoft(IdentityAtMicrosoft identity) {
    ArgumentNullException.ThrowIfNull(identity);

    StartedSignIn started = Started();

    Microsoft.AnswerToken(identity, started.Nonce);

    return await AnswerFromMicrosoftsPage(started, new Dictionary<string, string> { [CODE] = AUTHORIZATION_CODE, [STATE] = started.State });
  }

  /// <summary>
  /// Microsoft reports that the visitor cancelled the started sign-in: the browser posts <c>error=access_denied</c> and the
  /// <c>state</c> to the return address, with the same cross-site headers as <see cref="ReturnFromMicrosoft"/>, and
  /// follows the app's redirects as it does.
  /// </summary>
  public Task<Landing> CancelAtMicrosoft() => ReturnWithError(ACCESS_DENIED);

  /// <summary>
  /// An answer to the started sign-in that carries an error instead of a code, as Microsoft's page, or anyone who posts to
  /// the return address, can send it: the browser posts <c>error=</c><paramref name="error"/>, with
  /// <c>error_description=</c><paramref name="description"/> when given, and the <c>state</c>, with the same cross-site
  /// headers as <see cref="ReturnFromMicrosoft"/>, and follows the app's redirects as it does.
  /// </summary>
  public Task<Landing> ReturnWithError(string error, string? description = null) {
    StartedSignIn started = Started();
    Dictionary<string, string> answer = new() { [ERROR] = error, [STATE] = started.State };

    if (description is not null)
      answer[ERROR_DESCRIPTION] = description;

    return AnswerFromMicrosoftsPage(started, answer);
  }

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

    return await WhoAnswerOf(response);
  }

  /// <summary>
  /// <c>GET /api/me</c> as <see cref="AskWhoIsSignedIn"/> asks it, carrying <paramref name="header"/> once per value, each on
  /// its own line (<see cref="HeaderLines"/>); mapped the same way.
  /// </summary>
  public async Task<WhoAnswer> AskWhoIsSignedInWithHeaderLines(string header, params string[] values) {
    using HttpRequestMessage request = new(HttpMethod.Get, new Uri(ME, UriKind.Relative));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(JSON));
    HeaderLines.AddEachOnItsOwnLine(request.Headers, header, values);

    using HttpResponseMessage response = await Browser.SendAsync(request);

    return await WhoAnswerOf(response);
  }

  /// <summary>The answer to who is signed in, as <see cref="AskWhoIsSignedIn"/> describes the mapping.</summary>
  private static async Task<WhoAnswer> WhoAnswerOf(HttpResponseMessage response) {
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
  public async Task<SignOutAnswer> SignOut(string? fromSite = null) {
    using HttpRequestMessage request = SignOutRequest(fromSite);
    using HttpResponseMessage response = await Browser.SendAsync(request);

    return await SignOutAnswerOf(response);
  }

  /// <summary>
  /// The sign-out as <see cref="SignOut"/> sends it from <paramref name="fromSite"/>, for a guard that reads the refusal
  /// itself: the names of the problem description's members when the answer is the problem <c>Forbidden</c> (403), as
  /// <see cref="SignOutAnswer.Refused"/> reads it; <see langword="null"/> for any other answer.
  /// </summary>
  public async Task<IReadOnlyList<string>?> SignOutRefusalMembers(string fromSite) {
    using HttpRequestMessage request = SignOutRequest(fromSite);
    using HttpResponseMessage response = await Browser.SendAsync(request);

    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;

    return response.StatusCode == HttpStatusCode.Forbidden
      && JsonObjectOrNull(await response.Content.ReadAsStringAsync()) is JsonElement problem
      && IsProblem(mediaType, problem, response.StatusCode, FORBIDDEN)
        ? [.. problem.EnumerateObject().Select(static member => member.Name)]
        : null;
  }

  /// <summary><c>POST /api/auth/logout</c> as <see cref="SignOut"/> describes it, from the app's own page or from <paramref name="fromSite"/>.</summary>
  private static HttpRequestMessage SignOutRequest(string? fromSite) {
    HttpRequestMessage request = new(HttpMethod.Post, new Uri(LOGOUT, UriKind.Relative));
    request.Headers.Add(SEC_FETCH_SITE, fromSite is null ? SAME_ORIGIN : SAME_SITE);
    request.Headers.Add(ORIGIN, fromSite ?? _appAddress.GetLeftPart(UriPartial.Authority));
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(JSON));

    return request;
  }

  /// <summary>
  /// <c>POST /api/auth/logout</c> with the browser's cookies, carrying <paramref name="header"/> once per value, each on its
  /// own line (<see cref="HeaderLines"/>), and no other fetch metadata or origin; mapped as <see cref="SignOut"/> maps it.
  /// </summary>
  public async Task<SignOutAnswer> SignOutWithHeaderLines(string header, params string[] values) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(LOGOUT, UriKind.Relative));
    HeaderLines.AddEachOnItsOwnLine(request.Headers, header, values);
    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(JSON));

    using HttpResponseMessage response = await Browser.SendAsync(request);

    return await SignOutAnswerOf(response);
  }

  /// <summary>Signed out for 204; refused for the problem description <c>Forbidden</c> (403); anything else otherwise.</summary>
  private static async Task<SignOutAnswer> SignOutAnswerOf(HttpResponseMessage response) {
    if (response.StatusCode == HttpStatusCode.NoContent)
      return SignOutAnswer.SignedOut;

    if (response.StatusCode != HttpStatusCode.Forbidden)
      return SignOutAnswer.SomethingElse;

    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    bool refused = JsonObjectOrNull(await response.Content.ReadAsStringAsync()) is JsonElement body && IsProblem(mediaType, body, response.StatusCode, FORBIDDEN);

    return refused ? SignOutAnswer.Refused : SignOutAnswer.SomethingElse;
  }

  /// <summary>Moves the app copy's clock (<see cref="FakeMicrosoft.Clock"/>) forward by <paramref name="time"/>.</summary>
  public void Advance(TimeSpan time) => Microsoft.Clock.Advance(time);

  // For the guards in Conventions/, which check the channel itself (c007 design.md D2, D4): requests other sites make the
  // browser send, and the cookies the app set.

  /// <summary>The cookies the app's answer to the last <see cref="StartSignIn"/> set (the redirect to Microsoft).</summary>
  public IReadOnlyList<CookieSet> CookiesSetByTheStart() => _setByTheStart;

  /// <summary>The cookies the app's answer to the last post from Microsoft's page set (the return address's answer, before any redirect is followed).</summary>
  public IReadOnlyList<CookieSet> CookiesSetByTheReturn() => _setByTheReturn;

  /// <summary>
  /// <c>GET </c><paramref name="path"/> as an image on a page of another app on the same hosting domain makes the browser
  /// send it (D4): with the browser's cookies, <c>Sec-Fetch-Site: same-site</c>, <c>Sec-Fetch-Mode: no-cors</c>,
  /// <c>Sec-Fetch-Dest: image</c>, and no <c>Origin</c>. The browser takes the answer's cookies; nothing else is read.
  /// </summary>
  public async Task LoadAsAnotherAppsImage(string path) {
    using HttpRequestMessage request = new(HttpMethod.Get, new Uri(path, UriKind.Relative));
    request.Headers.Add(SEC_FETCH_SITE, SAME_SITE);
    request.Headers.Add(SEC_FETCH_MODE, NO_CORS);
    request.Headers.Add(SEC_FETCH_DEST, IMAGE);

    using HttpResponseMessage response = await Browser.SendAsync(request);
  }

  /// <summary>
  /// <c>POST </c><paramref name="path"/> with an empty form, as a page of another site makes the browser send it: with the
  /// browser's cookies, <c>Sec-Fetch-Site: cross-site</c>, <c>Sec-Fetch-Mode: navigate</c>, <c>Sec-Fetch-Dest: document</c>
  /// and that page's <c>Origin</c>. The browser takes the answer's cookies; nothing else is read.
  /// </summary>
  public async Task PostFormFromAnotherSite(string path) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(path, UriKind.Relative)) { Content = new FormUrlEncodedContent([]) };
    request.Headers.Add(SEC_FETCH_SITE, CROSS_SITE);
    request.Headers.Add(SEC_FETCH_MODE, NAVIGATE);
    request.Headers.Add(SEC_FETCH_DEST, DOCUMENT);
    request.Headers.Add(ORIGIN, ANOTHER_SITES_PAGE);

    using HttpResponseMessage response = await Browser.SendAsync(request);
  }

  /// <summary>
  /// <c>GET </c><paramref name="path"/> as the browser opens a page address, without following a redirect, read as
  /// <see cref="PagesDriver.ReadPage"/> reads a page: a redirect is not the app's page.
  /// </summary>
  public async Task<PageAnswer> OpenPageAddress(string path) {
    using HttpResponseMessage response = await Browser.GetAsync(new Uri(path, UriKind.Relative));

    return await PagesDriver.ReadPage(response);
  }

  /// <summary>The sign-in <see cref="StartSignIn"/> started; throws when there is none.</summary>
  private StartedSignIn Started() =>
    _started ?? throw new InvalidOperationException("No sign-in was started, or the app did not send the visitor to Microsoft: a step must start one first.");

  /// <summary>
  /// The browser posts <paramref name="answer"/> to the started sign-in's return address, as Microsoft's page makes it
  /// (D6): a form, sent cross-site from Microsoft's origin. Then it follows the app's redirects to where the visitor lands.
  /// </summary>
  private async Task<Landing> AnswerFromMicrosoftsPage(StartedSignIn started, Dictionary<string, string> answer) {
    using HttpRequestMessage request = new(HttpMethod.Post, started.ReturnAddress) { Content = new FormUrlEncodedContent(answer) };
    request.Headers.Add(SEC_FETCH_SITE, CROSS_SITE);
    request.Headers.Add(ORIGIN, MICROSOFTS_PAGES);

    using HttpResponseMessage response = await Browser.SendAsync(request);

    _setByTheReturn = CookiesSet(response);

    return await FollowToLanding(started.ReturnAddress, response);
  }

  /// <summary>Every cookie <paramref name="response"/> set, in header order, with its lifetime counted from the app copy's clock now.</summary>
  private List<CookieSet> CookiesSet(HttpResponseMessage response) {
    if (!response.Headers.TryGetValues(SET_COOKIE, out IEnumerable<string>? headers))
      return [];

    DateTimeOffset now = Microsoft.Clock.GetUtcNow();

    return [.. SetCookieHeaderValue.ParseList([.. headers]).Select(cookie => new CookieSet(
      cookie.Name.ToString(),
      cookie.Path.HasValue ? cookie.Path.ToString() : null,
      cookie.Domain.HasValue ? cookie.Domain.ToString() : null,
      cookie.Secure,
      cookie.HttpOnly,
      cookie.SameSite.ToString(),
      cookie.MaxAge ?? (cookie.Expires - now)))];
  }

  /// <summary>
  /// Follows the app's redirects on its own address, starting from <paramref name="answer"/> to a request for
  /// <paramref name="address"/>. <see cref="Landing.StartPage"/> when they end at <c>/</c> with the app's page
  /// (<see cref="PagesDriver.ReadPage"/>); <see cref="Landing.Elsewhere"/> when they end anywhere else, leave the app's
  /// address, or don't end.
  /// </summary>
  private async Task<Landing> FollowToLanding(Uri address, HttpResponseMessage answer) {
    Uri at = address;
    HttpResponseMessage response = answer;
    List<HttpResponseMessage> followed = [];

    try {
      for (int hop = 0; IsRedirect(response.StatusCode); hop++) {
        if (hop == MOST_REDIRECTS || response.Headers.Location is not Uri location)
          return Landing.Elsewhere;

        at = new Uri(at, location);

        if (!IsAt(at, _appAddress, UriComponents.SchemeAndServer))
          return Landing.Elsewhere;

        response = await Browser.GetAsync(at);
        followed.Add(response);
      }

      bool onStartPage = at.AbsolutePath == START_PAGE && at.Query.Length == 0 && await PagesDriver.ReadPage(response) == PageAnswer.TheApp;

      return onStartPage ? Landing.StartPage : Landing.Elsewhere;
    }
    finally {
      foreach (HttpResponseMessage page in followed)
        page.Dispose();
    }
  }

  private static bool IsRedirect(HttpStatusCode status) =>
    status is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

  /// <summary>Whether <paramref name="address"/> is <paramref name="place"/>, compared by <paramref name="parts"/> (by default: scheme, host, port and path).</summary>
  private static bool IsAt(Uri address, Uri place, UriComponents parts = UriComponents.SchemeAndServer | UriComponents.Path) =>
    Uri.Compare(address, place, parts, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;

  /// <summary>The query parameter's value when it occurs exactly once; otherwise <see langword="null"/>.</summary>
  private static string? Single(Dictionary<string, StringValues> query, string name) =>
    query.TryGetValue(name, out StringValues values) && values.Count == 1 ? values[0] : null;

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

  /// <summary>A started sign-in: what Microsoft's page sends back to the app (<c>state</c>), the token must carry (<c>nonce</c>), and where to.</summary>
  private sealed record StartedSignIn(string State, string Nonce, Uri ReturnAddress);
}