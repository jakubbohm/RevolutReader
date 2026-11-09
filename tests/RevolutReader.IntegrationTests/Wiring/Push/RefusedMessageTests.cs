using System.Net;
using System.Text;
using System.Text.Json;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// A message a push cannot carry is refused at the message endpoint (spec push-sending, "A message a push cannot carry is
/// refused"; c011 design.md D10; tasks 27.2, 27.3, 28.1, 30.6). With the right key: a request without an account, a
/// message whose title is only spaces or whose page is not a page of the app, and a body that is not the request's JSON
/// each get 400, FastEndpoints' validation problem (<c>application/problem+json</c>, titled <c>Bad Request</c>,
/// <c>errors</c> an array of <c>{ name, reason }</c>) naming exactly the refused member, <c>account</c>, <c>title</c>,
/// <c>page</c> or <c>body</c>, with a fixed reason and nothing the request sent. Everything else in each request is fine,
/// so only that member can be refused. The sketch puts the account rule and the unreadable body in
/// <c>MessageEndpoint</c> and the title and page rules in <c>PushMessages.Check</c>, which the endpoint applies before
/// calling the sender. The app copy's storage is never reached: a refused request reads no table.
/// </summary>
public sealed class RefusedMessageTests {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The account on the app copy's allowlist, as JSON.</summary>
  private const string ACCOUNT = $"\"{MessageEndpointApp.ALLOWED_ACCOUNT}\"";

  /// <summary>Distinctive texts, so none can turn up in a problem by coincidence.</summary>
  private const string TITLE = "Zkušební titulek 3e7a";
  private const string TEXT = "Zkušební zpráva 8b4c";
  private const string PAGE = "/transakce-1d9f";

  /// <summary>A number no problem holds by coincidence, sent where the account's text belongs.</summary>
  private const string NUMBER = "41927";

  /// <param name="account">The request's <c>account</c> member as JSON, or <see langword="null"/> to leave it out.</param>
  [Test]
  [Arguments(null)] // left out
  [Arguments("null")]
  [Arguments("\"\"")]
  public async Task A_message_without_an_account_is_refused_naming_the_account(string? account) =>
    await ShouldBeRefusedNaming("account", Message(account, $"\"{TITLE}\""), [TITLE, TEXT, PAGE]);

  /// <summary>Blank is missing (D10): the rules refuse it, and the endpoint answers before the sender sees it.</summary>
  [Test]
  public async Task A_message_whose_title_is_only_spaces_is_refused_naming_the_title() =>
    await ShouldBeRefusedNaming("title", Message(ACCOUNT, "\"   \""), [MessageEndpointApp.ALLOWED_ACCOUNT, TEXT, PAGE]);

  /// <summary>A page that is not a page of the app (D2) is refused by the rules, and the endpoint answers before the sender sees it.</summary>
  /// <param name="page">An absolute address, and an address on another host that starts with two slashes.</param>
  [Test]
  [Arguments("https://example.com/stranka-3c5d")]
  [Arguments("//example.com/stranka-3c5d")]
  public async Task A_message_whose_page_is_not_a_page_of_the_app_is_refused_naming_the_page(string page) =>
    await ShouldBeRefusedNaming(
      "page",
      $$"""{ "account": {{ACCOUNT}}, "title": "{{TITLE}}", "text": "{{TEXT}}", "page": "{{page}}" }""",
      [MessageEndpointApp.ALLOWED_ACCOUNT, TITLE, TEXT, "example.com", "stranka-3c5d"]);

  /// <param name="body">A body that is not the request's JSON.</param>
  /// <param name="sent">The values in it that the problem must not quote.</param>
  [Test]
  [Arguments($$"""{ "account": "{{MessageEndpointApp.ALLOWED_ACCOUNT}}", "title": "{{TITLE}}", "te""", new[] { MessageEndpointApp.ALLOWED_ACCOUNT, TITLE })] // cut off
  [Arguments($$"""["{{MessageEndpointApp.ALLOWED_ACCOUNT}}", "{{TITLE}}"]""", new[] { MessageEndpointApp.ALLOWED_ACCOUNT, TITLE })] // not an object
  [Arguments($$"""{ "account": {{NUMBER}}, "title": "{{TITLE}}", "text": "{{TEXT}}", "page": "{{PAGE}}" }""", new[] { NUMBER, TITLE, TEXT, PAGE })] // a number for a text
  public async Task A_body_that_is_not_the_requests_JSON_is_refused_naming_the_body(string body, string[] sent) =>
    await ShouldBeRefusedNaming("body", body, sent);

  /// <summary>The request's body: <paramref name="account"/> (left out when <see langword="null"/>) and <paramref name="title"/> as JSON, with the text and the page.</summary>
  private static string Message(string? account, string title) {
    string accountMember = account is null ? string.Empty : $"\"account\": {account}, ";

    return $$"""{ {{accountMember}}"title": {{title}}, "text": "{{TEXT}}", "page": "{{PAGE}}" }""";
  }

  /// <summary>
  /// Sends <paramref name="body"/> with the right key and expects FastEndpoints' validation problem naming exactly
  /// <paramref name="member"/> with a reason that is not blank, and none of <paramref name="sent"/> anywhere in it.
  /// </summary>
  private static async Task ShouldBeRefusedNaming(string member, string body, string[] sent) {
    await using MessageEndpointApp app = new();
    using HttpClient owner = app.CreateClient();
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(MessageEndpointApp.MESSAGES, UriKind.Relative)) {
      Content = new StringContent(body, Encoding.UTF8, JSON),
    };
    request.Headers.Add(MessageEndpointApp.MESSAGE_KEY_HEADER, app.MessageKey);

    using HttpResponseMessage response = await owner.SendAsync(request);
    string problemText = await response.Content.ReadAsStringAsync();
    string answer = $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {problemText}";

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, answer);
    response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON, answer);

    using JsonDocument problem = JsonDocument.Parse(problemText);
    JsonElement root = problem.RootElement;
    JsonElement refused = root.GetProperty("errors").EnumerateArray().ShouldHaveSingleItem(answer);

    root.ShouldSatisfyAllConditions(
      () => root.GetProperty("title").GetString().ShouldBe("Bad Request", answer),
      () => refused.GetProperty("name").GetString().ShouldBe(member, answer),
      () => refused.GetProperty("reason").GetString().ShouldNotBeNullOrWhiteSpace(answer),
      () => sent.Where(value => problemText.Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty($"never a value the request sent: {answer}"));
  }
}