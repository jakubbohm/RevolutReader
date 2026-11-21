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
/// Filled in by the wiring groups (tasks.md 3.1, 7.1); until then every method throws.
/// </summary>
public sealed class ArrivalDriver(HttpClient browser, FakeTimeProvider clock, CapturedLogEvents lines) {
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
  public Task<ReportAnswer> ReportReadAt(DateTimeOffset readAt) => throw new NotImplementedException();

  /// <summary><c>POST /api/push/arrivals</c> in the signed-in browser, with the JSON body <c>{}</c>: a report naming no read time.</summary>
  public Task<ReportAnswer> ReportWithNoReadTime() => throw new NotImplementedException();

  /// <summary>The <c>DelaySeconds</c> of every <c>PushArrived</c> line the app copy wrote, in the order written.</summary>
  public IReadOnlyList<long> RecordedDelays() => throw new NotImplementedException();
}