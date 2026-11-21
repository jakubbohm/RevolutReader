using System.Net;
using System.Text;
using System.Text.Json;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// A report whose read time is not a date and time (spec push-arrivals; c016 design.md D3, D7; tasks 7.2): Lucie, signed
/// in and allowed, reports an arrival whose <c>readAt</c> is <c>"yesterday"</c>. FastEndpoints cannot bind it, so it
/// answers before the endpoint runs: 400, its validation problem (<c>application/problem+json</c>, titled
/// <c>Bad Request</c>, a body <c>status</c> of 400, <c>errors</c> naming exactly <c>readAt</c> with a reason), and no
/// arrival is recorded (no <c>PushArrived</c> line). A read time
/// read as some default instead would reach the endpoint and be recorded, a delay of two thousand years (D3). The
/// scenarios pin a missing read time through the DSL; here the unreadable one. Each test has its own app copy
/// (<see cref="SubscriptionEndpointApp"/>).
/// </summary>
public sealed class UnreadableArrivalReportTests {
  private const string JSON = "application/json";
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>Where a phone reports a push's arrival (D3).</summary>
  private const string ARRIVALS = "/api/push/arrivals";

  /// <summary>The report's one member (D2), which the refusal names.</summary>
  private const string READ_AT = "readAt";

  /// <summary>The line an arrival is recorded as (D4).</summary>
  private const string PUSH_ARRIVED = "PushArrived";

  private const string LUCIE = MessageEndpointApp.ALLOWED_ACCOUNT;

  /// <summary>
  /// The harness's own check: a report with a read time, as System.Text.Json writes one, from Lucie signed in, is answered
  /// 204 and recorded as one <c>PushArrived</c> line. So the login cookie, the request's shape and the lines the tests read
  /// are the ones the endpoint uses, and the refusal below is the API's, not the harness's.
  /// </summary>
  [Test]
  public async Task A_report_with_a_read_time_from_Lucie_signed_in_is_answered_204_and_recorded() {
    await using SubscriptionEndpointApp app = new();
    using HttpClient lucie = app.SignedInAs(LUCIE);

    using HttpResponseMessage response = await Report(lucie, """{ "readAt": "2026-11-21T09:14:03.5123456+00:00" }""");
    string answer = await AnswerOf(response);

    response.StatusCode.ShouldBe(HttpStatusCode.NoContent, answer);
    app.LoggedEvents().Count(static name => name == PUSH_ARRIVED).ShouldBe(1, "one arrival recorded");
  }

  [Test]
  public async Task A_report_whose_read_time_is_not_a_date_and_time_is_answered_400_Bad_Request_and_nothing_is_recorded() {
    await using SubscriptionEndpointApp app = new();
    using HttpClient lucie = app.SignedInAs(LUCIE);

    using HttpResponseMessage response = await Report(lucie, """{ "readAt": "yesterday" }""");
    string problemText = await response.Content.ReadAsStringAsync();
    string answer = await AnswerOf(response);

    response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, answer);
    response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON, answer);

    using JsonDocument problem = JsonDocument.Parse(problemText);
    JsonElement root = problem.RootElement;
    JsonElement[] refused = [.. root.GetProperty("errors").EnumerateArray()];

    root.ShouldSatisfyAllConditions(
      () => root.GetProperty("title").GetString().ShouldBe("Bad Request", answer),
      () => root.GetProperty("status").GetInt32().ShouldBe(400, answer),
      () => refused.Select(static error => error.GetProperty("name").GetString()).ShouldBe([READ_AT], answer),
      () => refused.Where(static error => string.IsNullOrWhiteSpace(error.GetProperty("reason").GetString())).ShouldBeEmpty($"every reason given: {answer}"));
    app.LoggedEvents().ShouldNotContain(PUSH_ARRIVED, "no arrival recorded");
  }

  /// <summary><c>POST</c> of <paramref name="body"/> as JSON to the arrival endpoint, as the app's service worker sends it, minus the fetch metadata (see <see cref="SubscriptionEndpointApp"/>).</summary>
  private static async Task<HttpResponseMessage> Report(HttpClient client, string body) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(ARRIVALS, UriKind.Relative)) {
      Content = new StringContent(body, Encoding.UTF8, JSON),
    };

    return await client.SendAsync(request);
  }

  /// <summary>The answer's status, content type and body, for a failure's message.</summary>
  private static async Task<string> AnswerOf(HttpResponseMessage response) =>
    $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {await response.Content.ReadAsStringAsync()}";
}