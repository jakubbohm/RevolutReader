using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// A phone's reports of a push's arrival through the API, <c>POST /api/push/arrivals</c> (spec push-arrivals, c016
/// design.md D2–D4, D7), and what the server recorded. Status codes, headers, JSON and the log lines stay here; the DSL gets
/// <see cref="ReportAnswer"/> values and the recorded delays.
/// <list type="bullet">
/// <item><b>The phone's service worker</b> is the signed-in <see cref="HttpClient"/> <see cref="SignInDriver"/> signs in
/// with, its cookies the login, as <see cref="PushDriver"/> registers a device: <c>POST /api/push/arrivals</c> with the
/// JSON body <c>{ "readAt" }</c>, <c>readAt</c> written as System.Text.Json writes a <see cref="DateTimeOffset"/> (the
/// way the API wrote it into the push, which the service worker hands back unchanged, D2); for a report with no read time
/// the body <c>{}</c>. The request carries <c>Sec-Fetch-Site: same-origin</c> and the app's own <c>Origin</c>, as a service
/// worker's request to its own origin does (D3).</item>
/// <item><b>Exact shapes</b>, any other answer failing the step, naming it: an accepted report is 204 with no content
/// (<see cref="ReportAnswer.Accepted"/>). A refusal as <see cref="PushDriver"/>'s: <c>application/problem+json</c>, a body
/// <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (a plain status's RFC 9110 or RFC 7231 type
/// read as <see langword="null"/>), and the status its case belongs to, by the driver's own table:
/// <see cref="ProblemDescription.BadRequest"/> 400; a 400's <c>errors</c> (FastEndpoints' validation problem, D3) name
/// exactly one member, <c>readAt</c>, with a reason.</item>
/// <item><b>The record</b> is the app copy's <c>PushArrived</c> lines (D4), the capability's only public channel: the
/// owner reads the arrivals in the telemetry alone (D6, D7). Each line's <c>DelaySeconds</c>, a whole number, is one
/// recorded arrival's delay, in the order written, read from the app copy's capture (<see cref="CapturedLogEvents"/>).</item>
/// <item><b>The app's clock</b> is the app copy's <see cref="FakeTimeProvider"/>, which moves only when a test moves it,
/// so a read time given relative to <see cref="Now"/> is that far from the server's own time when the report arrives.</item>
/// </list>
/// Filled in by the wiring groups (tasks.md 3.1, 7.1).
/// </summary>
public sealed class ArrivalDriver(HttpClient browser, FakeTimeProvider clock, CapturedLogEvents lines) {
  /// <summary>Where a phone reports a push's arrival (D3).</summary>
  private const string ARRIVALS = "/api/push/arrivals";

  /// <summary>The report's one member (D2).</summary>
  private const string READ_AT = "readAt";

  /// <summary>The line an arrival is recorded as (D4), and its one value.</summary>
  private const string PUSH_ARRIVED = "PushArrived";
  private const string DELAY_SECONDS = "DelaySeconds";

  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The problem description's members the driver reads (RFC 9457).</summary>
  private const string TYPE = "type";
  private const string TITLE = "title";
  private const string STATUS = "status";

  /// <summary>How each of RFC 9110's and RFC 7231's types starts, which ASP.NET and FastEndpoints give a problem of a plain status.</summary>
  private const string RFC_9110_TYPE = "https://tools.ietf.org/html/rfc9110#section-";
  private const string RFC_7231_TYPE = "https://www.rfc-editor.org/rfc/rfc7231#section-";

  /// <summary>A validation problem's list of refused members and each one's members (FastEndpoints, D3).</summary>
  private const string ERRORS = "errors";
  private const string NAME = "name";
  private const string REASON = "reason";

  /// <summary>The fetch metadata a service worker's request to its own origin carries (D3).</summary>
  private const string SEC_FETCH_SITE = "Sec-Fetch-Site";
  private const string SAME_ORIGIN = "same-origin";
  private const string ORIGIN = "Origin";

  /// <summary>The refusals the DSL knows for a report, with the status each case belongs to.</summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.BadRequest] = HttpStatusCode.BadRequest,
  };

  /// <summary>How a plain status's type starts (RFC 9110 replaced RFC 7231; both name the status alone).</summary>
  private static readonly string[] _plainStatusTypes = [RFC_9110_TYPE, RFC_7231_TYPE];

  /// <summary>The signed-in browser, standing in for the phone's service worker.</summary>
  private HttpClient Browser => browser;

  /// <summary>The app copy's log lines, its <c>PushArrived</c> lines among them.</summary>
  private CapturedLogEvents Lines => lines;

  /// <summary>
  /// The app copy's clock (<see cref="FakeMicrosoft.Clock"/>), read as it is: a property may not throw
  /// <see cref="NotImplementedException"/> (CA1065), so this one member is no stub.
  /// </summary>
  public DateTimeOffset Now => clock.GetUtcNow();

  /// <summary><c>POST /api/push/arrivals</c> in the signed-in browser, with <c>{ "readAt" }</c> naming <paramref name="readAt"/>.</summary>
  public Task<ReportAnswer> ReportReadAt(DateTimeOffset readAt) => Report(new JsonObject { [READ_AT] = readAt });

  /// <summary><c>POST /api/push/arrivals</c> in the signed-in browser, with the JSON body <c>{}</c>: a report naming no read time.</summary>
  public Task<ReportAnswer> ReportWithNoReadTime() => Report(new JsonObject());

  /// <summary>
  /// The <c>DelaySeconds</c> of every <c>PushArrived</c> line the app copy wrote, in the order written. A line whose
  /// <c>DelaySeconds</c> is missing or not a whole number fails the step, naming what it holds.
  /// </summary>
  public IReadOnlyList<long> RecordedDelays() =>
    [.. Lines.ValuesOf(PUSH_ARRIVED).Select(static values => values.TryGetValue(DELAY_SECONDS, out object? delay) && delay is long seconds
      ? seconds
      : throw new InvalidOperationException($"A {PUSH_ARRIVED} line holds no whole number of seconds as {DELAY_SECONDS}: {string.Join(", ", values.Keys)}"))];

  /// <summary>
  /// <c>POST /api/push/arrivals</c> in the signed-in browser with <paramref name="report"/> as its JSON body, and the fetch
  /// metadata a service worker's request to its own origin carries (<c>Sec-Fetch-Site: same-origin</c>, <c>Origin</c> the
  /// app's address); read as the class describes.
  /// </summary>
  private async Task<ReportAnswer> Report(JsonObject report) {
    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(ARRIVALS, UriKind.Relative)) { Content = JsonContent.Create(report) };
    request.Headers.Add(SEC_FETCH_SITE, SAME_ORIGIN);
    request.Headers.Add(ORIGIN, AppOrigin());

    using HttpResponseMessage response = await Browser.SendAsync(request);
    string mediaType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    string body = await response.Content.ReadAsStringAsync();

    if (response.StatusCode == HttpStatusCode.NoContent && body.Length == 0)
      return ReportAnswer.Accepted;

    return JsonObjectOrNull(body) is JsonElement problem && RefusalOf(response.StatusCode, mediaType, problem) is ProblemDescription refusal
      ? ReportAnswer.Refused(refusal)
      : throw new InvalidOperationException($"POST {ARRIVALS} answered what no report answer fits: {(int)response.StatusCode} {response.Content.Headers.ContentType} {body}");
  }

  /// <summary>The app's own origin, the signed-in browser's address, as a service worker's request to it names it.</summary>
  private string AppOrigin() =>
    (Browser.BaseAddress ?? throw new InvalidOperationException("The signed-in browser has no address.")).GetLeftPart(UriPartial.Authority);

  /// <summary>
  /// The refusal, when the answer is a problem description of a case in <see cref="_statusByCase"/> with that case's status:
  /// <c>application/problem+json</c>, a body <c>status</c> equal to the response's, a <c>title</c> and a <c>type</c> (a plain
  /// status's RFC type, <see cref="_plainStatusTypes"/>, read as <see langword="null"/>); a 400's <c>errors</c> naming
  /// exactly one member, <c>readAt</c>, with a reason. Otherwise <see langword="null"/>.
  /// </summary>
  private static ProblemDescription? RefusalOf(HttpStatusCode status, string mediaType, JsonElement problem) {
    if (!string.Equals(mediaType, PROBLEM_JSON, StringComparison.OrdinalIgnoreCase) || Int(problem, STATUS) != (int)status)
      return null;

    if (Text(problem, TITLE) is not string title || Text(problem, TYPE) is not string type)
      return null;

    ProblemDescription description = new(title, _plainStatusTypes.Any(plain => type.StartsWith(plain, StringComparison.Ordinal)) ? null : type);

    if (!_statusByCase.TryGetValue(description, out HttpStatusCode caseStatus) || caseStatus != status)
      return null;

    return status != HttpStatusCode.BadRequest || NamesOnlyTheReadTime(problem) ? description : null;
  }

  /// <summary>Whether a 400's <c>errors</c> (FastEndpoints' validation problem, <c>[{ name, reason }]</c>) name exactly one member, <c>readAt</c>, with a reason.</summary>
  private static bool NamesOnlyTheReadTime(JsonElement problem) {
    if (!problem.TryGetProperty(ERRORS, out JsonElement errors) || errors.ValueKind != JsonValueKind.Array || errors.GetArrayLength() != 1)
      return false;

    JsonElement refused = errors[0];

    return string.Equals(Text(refused, NAME), READ_AT, StringComparison.Ordinal) && !string.IsNullOrWhiteSpace(Text(refused, REASON));
  }

  /// <summary>The member <paramref name="name"/> when it is a JSON number an <see cref="int"/> holds; otherwise <see langword="null"/>.</summary>
  private static int? Int(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetInt32(out int number) ? number : null;

  /// <summary>The member <paramref name="name"/> when it is a JSON string; otherwise <see langword="null"/>.</summary>
  private static string? Text(JsonElement value, string name) =>
    value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;

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
}