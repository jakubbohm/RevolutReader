using System.Net;
using System.Text.Json.Nodes;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Check;

/// <summary>
/// The check endpoint is hidden (c014 design.md D6; spec account-check, "The check answers only with its key"): a request
/// without the right check key gets exactly the answer an unknown <c>/api</c> address gets, so a probe cannot tell the
/// endpoint exists. The scenario covers a wrong key; here the other keyless requests, as c011's <c>KeylessMessageTests</c>
/// do for the message endpoint: no key header, the header twice (the right key on one line or both), and the message key
/// in its place (a key of its own, never the message key). Each request is sent to the endpoint and, the same in every
/// other way, to an address under <c>/api</c> no endpoint serves; the two answers are compared whole, apart from
/// <c>traceId</c>: the status, the content type and the body. The unknown address's answer is checked to be a 404 too, so
/// two equal failures cannot pass.
/// <para>
/// No request names a browser or an address, so an endpoint that let one through could still read nothing at the bank:
/// a check reads only as a present user (D7). Each test has its own app copy (<see cref="CheckEndpointApp"/>); a keyless
/// request reads no table. Written by the test-writer before the endpoint exists (tasks.md 3.4): the keyless requests get
/// the catch-all's 404 today, so those tests pass at once and guard the wiring; the tests' own check fails until the
/// endpoint answers.
/// </para>
/// </summary>
public sealed class KeylessCheckTests {
  private const string CHECK = CheckEndpointApp.CHECK;
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address";
  private const string CHECK_KEY_HEADER = CheckEndpointApp.CHECK_KEY_HEADER;

  /// <summary>The one member a problem description carries that differs per request (D6, as c011 design.md D10).</summary>
  private const string TRACE_ID = "traceId";

  /// <summary>What goes on a line of the key header sent twice.</summary>
  public enum KeyLine {
    /// <summary>The app copy's check key.</summary>
    Right,

    /// <summary>A made-up key of the same length, never the app copy's.</summary>
    Wrong,
  }

  [Test]
  public async Task A_check_without_the_key_header_gets_the_answer_of_an_unknown_address() {
    await using CheckEndpointApp app = new();

    await ShouldAnswerAsAnUnknownAddress(app, keyLines: []);
  }

  /// <summary>Each value on its own header line, so the app sees one header with two values (as c011's <c>KeylessMessageTests</c> send it).</summary>
  [Test]
  [Arguments(KeyLine.Right, KeyLine.Right)]
  [Arguments(KeyLine.Right, KeyLine.Wrong)]
  [Arguments(KeyLine.Wrong, KeyLine.Right)]
  public async Task A_check_with_the_key_header_twice_gets_the_answer_of_an_unknown_address(KeyLine first, KeyLine second) {
    await using CheckEndpointApp app = new();
    string wrongKey = MadeUpSettings.MessageKey();

    await ShouldAnswerAsAnUnknownAddress(app, keyLines: [KeyOf(first), KeyOf(second)]);

    string KeyOf(KeyLine line) => line == KeyLine.Right ? app.CheckKey : wrongKey;
  }

  /// <summary>The app copy's message key in the check key's header: the check has a key of its own (D6).</summary>
  [Test]
  public async Task A_check_with_the_message_key_instead_of_the_check_key_gets_the_answer_of_an_unknown_address() {
    await using CheckEndpointApp app = new();

    await ShouldAnswerAsAnUnknownAddress(app, keyLines: [app.MessageKey]);
  }

  /// <summary>
  /// The tests' own check: with the right key once, the same request gets an answer of its own (it names no browser, so it
  /// is refused before anything is read), not the unknown address's. So the header's name and the app copy's key are the
  /// ones the endpoint reads, and the comparison above tells the two answers apart.
  /// </summary>
  [Test]
  public async Task With_the_right_key_once_the_endpoint_answers_otherwise_than_an_unknown_address() {
    await using CheckEndpointApp app = new();
    using HttpClient phone = app.CreateClient();

    string atTheEndpoint = await WholeAnswer(phone, CHECK, [app.CheckKey]);
    string atAnUnknownAddress = await WholeAnswer(phone, UNKNOWN_API_ADDRESS, [app.CheckKey]);

    atTheEndpoint.ShouldNotBe(atAnUnknownAddress, "with the right key the endpoint reads the request");
  }

  /// <summary>
  /// Sends <c>POST</c>, with no body and <paramref name="keyLines"/> each on its own key header line (none: no header), to
  /// the check endpoint and to the unknown address, and compares the two answers whole, apart from <c>traceId</c>; the
  /// unknown address's must be a 404.
  /// </summary>
  private static async Task ShouldAnswerAsAnUnknownAddress(CheckEndpointApp app, string[] keyLines) {
    using HttpClient phone = app.CreateClient();

    string atTheEndpoint = await WholeAnswer(phone, CHECK, keyLines);
    string atAnUnknownAddress = await WholeAnswer(phone, UNKNOWN_API_ADDRESS, keyLines);

    atAnUnknownAddress.ShouldStartWith($"{(int)HttpStatusCode.NotFound} ", Case.Sensitive, "an unknown /api address answers 404");
    atTheEndpoint.ShouldBe(atAnUnknownAddress, "the check endpoint without the right key answers exactly as an unknown /api address");
  }

  /// <summary>The answer to a body-less <c>POST</c> as one text: the status, the content type and the body, a JSON object's without its <c>traceId</c>.</summary>
  private static async Task<string> WholeAnswer(HttpClient phone, string address, string[] keyLines) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(address, UriKind.Relative));

    foreach (string key in keyLines) {
      if (!request.Headers.TryAddWithoutValidation(CHECK_KEY_HEADER, key))
        throw new InvalidOperationException($"The request header {CHECK_KEY_HEADER} could not be added.");
    }

    using HttpResponseMessage response = await phone.SendAsync(request);
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