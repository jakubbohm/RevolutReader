using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// The owner's message endpoint is hidden (c011 design.md D10; review finding R6): a request without the right message
/// key gets exactly the answer an unknown <c>/api</c> address gets, so a probe cannot tell the endpoint exists. The
/// scenario covers a wrong key; here the other keyless requests: no key header with a valid body, no key header with a
/// body that is not JSON (the key is checked before the body is read, so never a binding 400), and the header twice, the
/// right key on one line or both. Each request is sent to the endpoint and, the same in every other way, to an address
/// under <c>/api</c> no endpoint serves; the two answers are compared whole, apart from <c>traceId</c>: the status, the
/// content type and the body. The unknown address's answer is checked to be a 404 too, so two equal failures cannot pass.
/// <para>
/// Each test has its own app copy (<see cref="MessageEndpointApp"/>); a keyless request reads no table. Written by the
/// test-writer while the endpoint already existed (group 10), so it may pass at once.
/// </para>
/// </summary>
public sealed class KeylessMessageTests {
  private const string MESSAGES = MessageEndpointApp.MESSAGES;
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address";
  private const string MESSAGE_KEY_HEADER = MessageEndpointApp.MESSAGE_KEY_HEADER;
  private const string JSON = "application/json";

  /// <summary>The one member a problem description carries that differs per request (D10).</summary>
  private const string TRACE_ID = "traceId";

  /// <summary>A message to the account on the app copy's allowlist, which the endpoint would send with the key.</summary>
  private const string VALID_BODY = """{ "account": "lucie@example.com", "title": "Ahoj", "text": "Zkušební zpráva", "page": "/" }""";

  /// <summary>A body that is not JSON: the start of one, cut off.</summary>
  private const string MALFORMED_BODY = """{ "account": "lucie@exa""";

  /// <summary>What goes on a line of the key header sent twice.</summary>
  public enum KeyLine {
    /// <summary>The app copy's message key.</summary>
    Right,

    /// <summary>A made-up key of the same length, never the app copy's.</summary>
    Wrong,
  }

  [Test]
  public async Task A_request_without_the_key_header_and_with_a_valid_body_gets_the_answer_of_an_unknown_address() {
    await using MessageEndpointApp app = new();

    await ShouldAnswerAsAnUnknownAddress(app, VALID_BODY, keyLines: []);
  }

  [Test]
  public async Task A_request_without_the_key_header_and_with_a_malformed_body_gets_the_answer_of_an_unknown_address() {
    await using MessageEndpointApp app = new();

    await ShouldAnswerAsAnUnknownAddress(app, MALFORMED_BODY, keyLines: []);
  }

  /// <summary>Each value on its own header line, so the app sees one header with two values (as the acceptance harness's <c>HeaderLines</c> found on the test server).</summary>
  [Test]
  [Arguments(KeyLine.Right, KeyLine.Right)]
  [Arguments(KeyLine.Right, KeyLine.Wrong)]
  [Arguments(KeyLine.Wrong, KeyLine.Right)]
  public async Task A_request_with_the_key_header_twice_gets_the_answer_of_an_unknown_address(KeyLine first, KeyLine second) {
    await using MessageEndpointApp app = new();
    string wrongKey = MessageEndpointApp.MadeUpMessageKey();

    await ShouldAnswerAsAnUnknownAddress(app, VALID_BODY, keyLines: [KeyOf(first), KeyOf(second)]);

    string KeyOf(KeyLine line) => line == KeyLine.Right ? app.MessageKey : wrongKey;
  }

  /// <summary>
  /// The tests' own check: with the right key on one line, the same request gets an answer of its own (the body is not
  /// JSON, so it is refused without reading a table), not the unknown address's. So the header's name and the app copy's
  /// key are the ones the endpoint reads, and the comparison above tells the two answers apart.
  /// </summary>
  [Test]
  public async Task With_the_right_key_once_the_endpoint_answers_otherwise_than_an_unknown_address() {
    await using MessageEndpointApp app = new();
    using HttpClient owner = app.CreateClient();

    string atTheEndpoint = await WholeAnswer(owner, MESSAGES, MALFORMED_BODY, [app.MessageKey]);
    string atAnUnknownAddress = await WholeAnswer(owner, UNKNOWN_API_ADDRESS, MALFORMED_BODY, [app.MessageKey]);

    atTheEndpoint.ShouldNotBe(atAnUnknownAddress, "with the right key the endpoint reads the request");
  }

  /// <summary>
  /// Sends <c>POST</c> with <paramref name="body"/> as JSON and <paramref name="keyLines"/> each on its own key header line
  /// (none: no header) to the message endpoint and to the unknown address, and compares the two answers whole, apart from
  /// <c>traceId</c>; the unknown address's must be a 404.
  /// </summary>
  private static async Task ShouldAnswerAsAnUnknownAddress(MessageEndpointApp app, string body, string[] keyLines) {
    using HttpClient owner = app.CreateClient();

    string atTheEndpoint = await WholeAnswer(owner, MESSAGES, body, keyLines);
    string atAnUnknownAddress = await WholeAnswer(owner, UNKNOWN_API_ADDRESS, body, keyLines);

    atAnUnknownAddress.ShouldStartWith($"{(int)HttpStatusCode.NotFound} ", Case.Sensitive, "an unknown /api address answers 404");
    atTheEndpoint.ShouldBe(atAnUnknownAddress, "the message endpoint without the right key answers exactly as an unknown /api address");
  }

  /// <summary>The answer as one text: the status, the content type and the body, a JSON object's without its <c>traceId</c>.</summary>
  private static async Task<string> WholeAnswer(HttpClient owner, string address, string body, string[] keyLines) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(address, UriKind.Relative)) {
      Content = new StringContent(body, Encoding.UTF8, JSON),
    };

    foreach (string key in keyLines) {
      if (!request.Headers.TryAddWithoutValidation(MESSAGE_KEY_HEADER, key))
        throw new InvalidOperationException($"The request header {MESSAGE_KEY_HEADER} could not be added.");
    }

    using HttpResponseMessage response = await owner.SendAsync(request);
    string answer = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {WithoutTraceId(answer)}";
  }

  /// <summary><paramref name="body"/> without its <c>traceId</c> when it is a JSON object; otherwise as it is.</summary>
  private static string WithoutTraceId(string body) {
    JsonNode? parsed;

    try {
      parsed = JsonNode.Parse(body);
    }
    catch (System.Text.Json.JsonException) {
      return body;
    }

    if (parsed is not JsonObject problem)
      return body;

    _ = problem.Remove(TRACE_ID);

    return problem.ToJsonString();
  }

}