using System.Net;
using RevolutReader.Api.Push;
using Shouldly;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace RevolutReader.IntegrationTests.Wiring.WebPush;

/// <summary>
/// The push adapter (<see cref="WebPushDelivery"/>, c011 design.md D3, D13) reads a push service's 404 and 410 as the
/// device gone, with that status, and its 201 as delivered. The adapter comes from the app's own registration
/// (<see cref="PushAdapter"/>); the push service is a WireMock.Net server, never a real one.
/// </summary>
public sealed class GoneDeviceTests {
  private const string PUSH_PATH = "/push/made-up-device";

  /// <param name="status">A push service's answer for a subscription that no longer exists.</param>
  [Test]
  [Arguments(HttpStatusCode.NotFound)]
  [Arguments(HttpStatusCode.Gone)]
  public async Task A_push_service_answering_that_the_device_is_gone_is_DeviceGone_with_the_status(HttpStatusCode status) {
    DeliveryOutcome outcome = await DeliverTo(status);

    outcome.Value.ShouldBe(new DeviceGone((int)status));
  }

  /// <summary>The proof the adapter reaches the server and reads it: the success push services answer is delivered.</summary>
  [Test]
  public async Task A_push_service_taking_the_push_is_Delivered() {
    DeliveryOutcome outcome = await DeliverTo(HttpStatusCode.Created);

    outcome.Value.ShouldBeOfType<Delivered>();
  }

  /// <summary>One push to a device at a WireMock.Net push service that answers <paramref name="status"/>.</summary>
  private static async Task<DeliveryOutcome> DeliverTo(HttpStatusCode status) {
    using WireMockServer pushService = WireMockServer.Start();
    pushService.Given(Request.Create().WithPath(PUSH_PATH).UsingPost()).RespondWith(Response.Create().WithStatusCode(status));
    await using PushAdapter adapter = new();

    return await adapter.Delivery.Deliver(PushAdapter.Device(new Uri(new Uri(pushService.Url!), PUSH_PATH)), PushAdapter.Push, CancellationToken.None);
  }
}