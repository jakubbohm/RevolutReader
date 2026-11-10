using System.Net;
using System.Net.Sockets;
using RevolutReader.Api.Push;
using Shouldly;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace RevolutReader.IntegrationTests.Wiring.WebPush;

/// <summary>
/// A push that fails at the push service (c011 design.md D1, D3, D13): any answer but success or gone is
/// <see cref="DeliveryFailed"/> with its status, 429 included and never retried; no connection and the client's own
/// timeout are <see cref="DeliveryFailed"/> with no status; the caller's cancellation passes on as cancellation. The
/// adapter comes from the app's own registration (<see cref="PushAdapter"/>); the push service is a WireMock.Net server,
/// or a port held bound and not listening, never a real one.
/// </summary>
public sealed class FailedPushTests {
  private const string PUSH_PATH = "/push/made-up-device";

  /// <summary>Longer than any timeout a test here waits for, so only the timeout or the cancellation can end the request.</summary>
  private static readonly TimeSpan _slowAnswer = TimeSpan.FromSeconds(10);

  /// <param name="status">An answer that is neither success nor gone.</param>
  [Test]
  [Arguments(HttpStatusCode.InternalServerError)]
  [Arguments(HttpStatusCode.BadRequest)]
  [Arguments(HttpStatusCode.Forbidden)]
  public async Task Any_other_answer_is_DeliveryFailed_with_its_status(HttpStatusCode status) {
    using WireMockServer pushService = PushServiceAnswering(Response.Create().WithStatusCode(status));
    await using PushAdapter adapter = new();

    DeliveryOutcome outcome = await adapter.Delivery.Deliver(DeviceAt(pushService), PushAdapter.Push, CancellationToken.None);

    outcome.Value.ShouldBe(new DeliveryFailed((int)status));
  }

  /// <summary>
  /// 429 is a failure with its status, and the push is one request: the library's own retry after a 429 is off (D1), so a
  /// <c>Retry-After</c> brings no second request, which would spend the time of every other device's push.
  /// </summary>
  [Test]
  public async Task Too_many_requests_is_DeliveryFailed_with_429_after_exactly_one_request() {
    using WireMockServer pushService = PushServiceAnswering(Response.Create().WithStatusCode(HttpStatusCode.TooManyRequests).WithHeader("Retry-After", "1"));
    await using PushAdapter adapter = new();

    DeliveryOutcome outcome = await adapter.Delivery.Deliver(DeviceAt(pushService), PushAdapter.Push, CancellationToken.None);

    outcome.ShouldSatisfyAllConditions(
      () => outcome.Value.ShouldBe(new DeliveryFailed(429)),
      () => pushService.LogEntries.Count.ShouldBe(1, "one request, never retried"));
  }

  /// <summary>
  /// A push service nothing answers at is a failure with no status. The port is held bound and not listening for the whole
  /// test, so no other test's server can take it while this one connects (issue #68's lesson).
  /// </summary>
  [Test]
  public async Task No_connection_is_DeliveryFailed_with_no_status() {
    using Socket heldPort = new(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp) { ExclusiveAddressUse = true };
    heldPort.Bind(new IPEndPoint(IPAddress.Loopback, 0));
    int port = ((IPEndPoint)heldPort.LocalEndPoint!).Port;
    await using PushAdapter adapter = new();

    DeliveryOutcome outcome = await adapter.Delivery.Deliver(PushAdapter.Device(new Uri($"http://127.0.0.1:{port}{PUSH_PATH}")), PushAdapter.Push, CancellationToken.None);

    outcome.Value.ShouldBe(new DeliveryFailed(Status: null));
  }

  /// <summary>A push service that answers later than <c>Push:RequestTimeout</c> is a failure with no status (D13).</summary>
  [Test]
  public async Task The_clients_own_timeout_is_DeliveryFailed_with_no_status() {
    using WireMockServer pushService = PushServiceAnswering(Response.Create().WithStatusCode(HttpStatusCode.Created).WithDelay(_slowAnswer));
    await using PushAdapter adapter = new(requestTimeout: TimeSpan.FromSeconds(1)); // the shortest the setting allows

    DeliveryOutcome outcome = await adapter.Delivery.Deliver(DeviceAt(pushService), PushAdapter.Push, CancellationToken.None);

    outcome.Value.ShouldBe(new DeliveryFailed(Status: null));
  }

  /// <summary>
  /// The caller's cancellation while the push service has not answered passes on as cancellation, never as a failed device
  /// (D13): the client's own timeout is long, so only the caller's token ends the request.
  /// </summary>
  [Test]
  public async Task The_callers_cancellation_passes_on_as_cancellation() {
    using WireMockServer pushService = PushServiceAnswering(Response.Create().WithStatusCode(HttpStatusCode.Created).WithDelay(_slowAnswer));
    await using PushAdapter adapter = new(requestTimeout: TimeSpan.FromMinutes(1));
    using CancellationTokenSource caller = new(TimeSpan.FromMilliseconds(300));

    Exception? thrown = null;

    try {
      _ = await adapter.Delivery.Deliver(DeviceAt(pushService), PushAdapter.Push, caller.Token);
    }
    catch (OperationCanceledException exception) {
      thrown = exception;
    }

    thrown.ShouldNotBeNull("the caller's cancellation ends the push as cancelled, not with an outcome");
  }

  /// <summary>A WireMock.Net push service that answers every push at <see cref="PUSH_PATH"/> with <paramref name="answer"/>.</summary>
  private static WireMockServer PushServiceAnswering(IResponseBuilder answer) {
    WireMockServer pushService = WireMockServer.Start();
    pushService.Given(Request.Create().WithPath(PUSH_PATH).UsingPost()).RespondWith(answer);

    return pushService;
  }

  private static PushDevice DeviceAt(WireMockServer pushService) => PushAdapter.Device(new Uri(new Uri(pushService.Url!), PUSH_PATH));
}