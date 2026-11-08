using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;
using WireMock.RequestBuilders;
using WireMock.ResponseBuilders;
using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// No outgoing HTTP client retries by default (c008 design.md D10, c001 design.md D5): a client gets retries only from a
/// policy its own change decides, on that client alone, as the bank client has (c008). With the resilience package in the
/// repository, one line in ServiceDefaults (a resilience handler in <c>ConfigureHttpClientDefaults</c>) would give every
/// client retries. So the app copy's plain client from <see cref="IHttpClientFactory"/>, which gets exactly the defaults,
/// sends one request to a local server that answers 503, and exactly one request may arrive. A rule, not a scenario.
/// <para>
/// This app copy runs on the system clock, not on the fake clock every other app copy gets (<see cref="FakeMicrosoft.Clock"/>):
/// a retry policy waits on the app's clock, and on a clock that only a test moves its first wait would never end, so no
/// second request would ever come and this test would pass with retries switched on. On the system clock the template's
/// first wait is about 2 s. The call is given <see cref="_waitAtMost"/>, which only a retrying client ever uses up, before
/// the requests are counted.
/// </para>
/// <para>
/// Proven to fail (lesson R-31's practice), 2026-11-08: with <c>AddStandardResilienceHandler()</c> added to
/// <c>ConfigureHttpClientDefaults</c> in ServiceDefaults for a probe, this test failed after about 8.5 s ("requests that
/// arrived at the server answering 503 should be 1 but was 4"); on the fake clock instead, with the same probe, it passed
/// after its 10 s with one request, as foreseen above. Without the probe, it passes at once.
/// </para>
/// </summary>
public sealed class HttpClientDefaultsTests : AcceptanceTest {
  /// <summary>Long enough for a retry policy's first waits on the system clock (the template's: about 2 s, then 4 s, spread at random).</summary>
  private static readonly TimeSpan _waitAtMost = TimeSpan.FromSeconds(10);

  [Test]
  public async Task A_plain_client_from_the_apps_HttpClient_factory_sends_a_request_answered_503_only_once() {
    Services.GetRequiredService<TimeProvider>().ShouldBeSameAs(TimeProvider.System, "the app copy's clock, which a retry policy waits on");

    using WireMockServer unavailable = WireMockServer.Start(new WireMockServerSettings { AdditionalServiceRegistration = FakeBank.SilenceHostingTelemetry });
    unavailable.Given(Request.Create().UsingAnyMethod()).RespondWith(Response.Create().WithStatusCode(HttpStatusCode.ServiceUnavailable));
    using HttpClient http = Services.GetRequiredService<IHttpClientFactory>().CreateClient();
    using CancellationTokenSource inTime = new(_waitAtMost);

    try {
      using HttpResponseMessage answer = await http.GetAsync(new Uri(unavailable.Url ?? throw new InvalidOperationException("The server started without an address.")), inTime.Token);

      answer.StatusCode.ShouldBe(HttpStatusCode.ServiceUnavailable);
    }
    catch (OperationCanceledException) when (inTime.IsCancellationRequested) {
      // Still retrying when the time ran out: the count below shows how many requests arrived.
    }

    unavailable.LogEntries.Count.ShouldBe(1, "requests that arrived at the server answering 503");
  }

  /// <summary>As every app copy, then the system clock as the app's only <see cref="TimeProvider"/>, after the fake one.</summary>
  protected override void ConfigureWebHostBuilder(IWebHostBuilder builder) {
    base.ConfigureWebHostBuilder(builder);

    builder.ConfigureTestServices(static services => {
      services.RemoveAll<TimeProvider>();
      services.AddSingleton(TimeProvider.System);
    });
  }
}