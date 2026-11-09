using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Push;
using Shouldly;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;

namespace RevolutReader.IntegrationTests.Wiring.WebPush;

/// <summary>
/// The push adapter (<see cref="WebPushDelivery"/>, c011 design.md D3, D13) reads a push service's 404 and 410 as the
/// device gone, with that status, and its 201 as delivered. The adapter comes from the app's own registration
/// (<see cref="PushRegistration.AddPush"/>) on made-up settings, a VAPID pair and a device's keys generated per test; the
/// push service is a WireMock.Net server, never a real one.
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

    await using ServiceProvider app = App();
    using IServiceScope scope = app.CreateScope();
    IPushDelivery delivery = scope.ServiceProvider.GetRequiredService<IPushDelivery>();

    OutgoingPush push = new("""{"web_push":8030,"notification":{"title":"Ahoj","navigate":"https://app.example.net/"}}""", TimeSpan.FromHours(24), PushUrgency.High);

    return await delivery.Deliver(Device(new Uri(new Uri(pushService.Url!), PUSH_PATH)), push, CancellationToken.None);
  }

  /// <summary>The app's push registration on made-up settings: a VAPID pair generated here, a made-up message key and app address.</summary>
  private static ServiceProvider App() {
    using ECDsa vapid = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    ECParameters key = vapid.ExportParameters(includePrivateParameters: true);

    IConfiguration settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
      [$"{PushOptions.SECTION}:{nameof(PushOptions.VapidPublicKey)}"] = Base64Url.EncodeToString([0x04, .. key.Q.X!, .. key.Q.Y!]),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.VapidPrivateKey)}"] = Base64Url.EncodeToString(key.D!),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.MessageKey)}"] = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32)),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.Subject)}"] = "https://app.example.net",
      [$"{PushOptions.SECTION}:{nameof(PushOptions.Services)}:Made-up"] = "https://push.example.net",
    }).Build();

    ServiceCollection services = new();
    services.AddSingleton(settings);
    services.AddLogging();
    services.AddPush();

    return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = false });
  }

  /// <summary>A device at <paramref name="pushAddress"/> with keys as a browser makes them: a P-256 public point and a 16-byte secret.</summary>
  private static PushDevice Device(Uri pushAddress) {
    using ECDiffieHellman browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    ECParameters point = browser.ExportParameters(includePrivateParameters: false);

    return new PushDevice(
      pushAddress.AbsoluteUri,
      Base64Url.EncodeToString([0x04, .. point.Q.X!, .. point.Q.Y!]),
      Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
      "someone@example.com");
  }
}