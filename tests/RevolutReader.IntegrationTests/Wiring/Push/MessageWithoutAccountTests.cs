using System.Net;
using System.Text;
using System.Text.Json;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// A message without an account is refused, naming the account (spec push-sending, "A message a push cannot carry is
/// refused"; c011 design.md D10; task 27.3). The sketch puts this rule in <c>MessageEndpoint</c>, beside
/// <c>PushMessages.Check</c> (whose message has no account), so it is checked at the endpoint: with the right key, a body
/// whose <c>account</c> is left out, <c>null</c> or empty gets 400, FastEndpoints' validation problem (titled
/// <c>Bad Request</c>, <c>errors</c> an array of <c>{ name, reason }</c>) naming <c>account</c> alone, with a fixed reason
/// and none of the message's values. The rest of the message is fine, so only the account can be refused. The app copy's
/// storage is never reached: a refused request reads no table.
/// </summary>
public sealed class MessageWithoutAccountTests {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>Distinctive texts, so none can turn up in the problem by coincidence.</summary>
  private const string TITLE = "Zkušební titulek 3e7a";
  private const string TEXT = "Zkušební zpráva 8b4c";
  private const string PAGE = "/transakce-1d9f";

  /// <param name="account">The request's <c>account</c> member as JSON, or <see langword="null"/> to leave it out.</param>
  [Test]
  [Arguments(null)] // left out
  [Arguments("null")]
  [Arguments("\"\"")]
  public async Task A_message_without_an_account_is_refused_naming_the_account(string? account) {
    await using MessageEndpointApp app = new();
    using HttpClient owner = app.CreateClient();
    string accountMember = account is null ? string.Empty : $"\"account\": {account}, ";
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(MessageEndpointApp.MESSAGES, UriKind.Relative)) {
      Content = new StringContent($$"""{ {{accountMember}}"title": "{{TITLE}}", "text": "{{TEXT}}", "page": "{{PAGE}}" }""", Encoding.UTF8, JSON),
    };
    request.Headers.Add(MessageEndpointApp.MESSAGE_KEY_HEADER, app.MessageKey);

    using HttpResponseMessage response = await owner.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();
    string answer = $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {body}";

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, answer);
    response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON, answer);

    using JsonDocument problem = JsonDocument.Parse(body);
    JsonElement root = problem.RootElement;
    JsonElement refused = root.GetProperty("errors").EnumerateArray().ShouldHaveSingleItem(answer);

    root.ShouldSatisfyAllConditions(
      () => root.GetProperty("title").GetString().ShouldBe("Bad Request", answer),
      () => refused.GetProperty("name").GetString().ShouldBe("account", answer),
      () => refused.GetProperty("reason").GetString().ShouldNotBeNullOrWhiteSpace(answer),
      () => new[] { TITLE, TEXT, PAGE }.Where(value => body.Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty($"never a value of the message: {answer}"));
  }
}