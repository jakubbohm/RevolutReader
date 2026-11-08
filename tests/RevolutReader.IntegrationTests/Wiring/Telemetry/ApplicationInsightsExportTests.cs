using System.Diagnostics;
using Azure.Core;
using Azure.Core.Pipeline;
using Azure.Monitor.OpenTelemetry.Exporter;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;
using RevolutReader.ServiceDefaults;
using Shouldly;
using WireMock.ResponseBuilders;
using WireMock.Server;
using WireMockRequest = WireMock.RequestBuilders.Request;

namespace RevolutReader.IntegrationTests.Wiring.Telemetry;

/// <summary>
/// Only the deployed app exports to Application Insights (c006 design.md D8 b, D10, D12): ServiceDefaults adds the Azure
/// Monitor exporter only when <c>APPLICATIONINSIGHTS_CONNECTION_STRING</c> is set, for traces and logs and never the
/// app's metrics, signed in with the managed identity named by <c>AZURE_CLIENT_ID</c>; with the connection string but no
/// client ID the app does not start, and the message names the setting, never a value.
/// <para>
/// Each test builds a host on the production service defaults and records one of each signal. What would reach
/// Application Insights is observed where it would leave: the exporter's transport is the test's
/// <see cref="FakeIngestion"/>, so nothing is sent anywhere. The exporter takes its transport, a made-up credential and
/// "no offline storage" from the options the host's services configure, which the production code leaves alone: so no
/// token is ever asked of the managed identity endpoint, and nothing is written to disk. The connection string is made
/// up, with a unique key per test (the exporter shares one sender per connection string in a process) and an ingestion
/// address in no Azure region (RFC 2606's <c>.invalid</c>).
/// </para>
/// <para>
/// The exporter also keeps statistics about itself: "statsbeat", sent to Microsoft's own endpoint, and SDK statistics,
/// whose first export asks the Azure instance metadata endpoint (169.254.169.254) what kind of machine it runs on. On a
/// CI runner, an Azure VM, that endpoint answers. Both are switched off for this test process by their documented
/// environment variables (<see cref="SwitchOffTheExportersOwnStatistics"/>); nothing else in the process reads them.
/// </para>
/// </summary>
public sealed partial class ApplicationInsightsExportTests {
  /// <summary>The app's name, which names its own trace source.</summary>
  private const string APPLICATION_NAME = "RevolutReader.Api";

  private const string CONNECTION_STRING = "APPLICATIONINSIGHTS_CONNECTION_STRING";
  private const string CLIENT_ID = "AZURE_CLIENT_ID";

  /// <summary>The metric the trace exporter sends with each batch to carry the app's resource description.</summary>
  private const string RESOURCE_RECORD = "_OTELRESOURCE_";

  /// <summary>Made up: the shape of a user-assigned identity's client ID.</summary>
  private const string MADE_UP_CLIENT_ID = "11111111-2222-3333-4444-555555555555";

  /// <summary>Before the first exporter is built: the SDK reads these once, at its first use in the process.</summary>
  [Before(Class)]
  public static void SwitchOffTheExportersOwnStatistics() {
    Environment.SetEnvironmentVariable("APPLICATIONINSIGHTS_STATSBEAT_DISABLED", "true");
    Environment.SetEnvironmentVariable("APPLICATIONINSIGHTS_SDKSTATS_DISABLED", "true");
  }

  /// <param name="connectionString">Not declared at all; empty, as <c>appsettings.json</c> declares it; blank.</param>
  /// <param name="clientId">The client ID alongside: none, empty, or set, which on its own changes nothing.</param>
  [Test]
  [Arguments(null, null)]
  [Arguments("", "")]
  [Arguments("   ", MADE_UP_CLIENT_ID)]
  public void Without_the_connection_string_nothing_is_sent_to_Application_Insights(string? connectionString, string? clientId) {
    FakeIngestion ingestion;

    using (HostOnServiceDefaults host = new(Settings((CONNECTION_STRING, connectionString), (CLIENT_ID, clientId)))) {
      ingestion = host.Ingestion;
      host.RecordsOneOfEachSignal();
    }

    ingestion.Requests.ShouldBe(0);
  }

  /// <summary>
  /// The request's trace and the log line written while it ran both arrive. The app's metrics stay local (D10): none of
  /// its own instruments, and none of the trace exporter's own metrics (standard metrics, performance counters). The one
  /// metric item the trace exporter adds to each batch, <c>_OTELRESOURCE_</c>, carries the app's resource description
  /// (service name, SDK version), not a measurement; only an environment variable turns it off, so it is allowed here.
  /// </summary>
  [Test]
  public void With_the_connection_string_traces_and_logs_reach_Application_Insights_and_the_apps_metrics_do_not() {
    FakeIngestion ingestion;

    using (HostOnServiceDefaults host = new(Settings((CONNECTION_STRING, MadeUpConnectionString()), (CLIENT_ID, MADE_UP_CLIENT_ID)))) {
      ingestion = host.Ingestion;
      host.RecordsOneOfEachSignal();
    }

    IReadOnlyList<SentItem> sent = ingestion.Items;
    string described = string.Join(", ", sent.Select(static item => item.MetricNames.Count == 0 ? item.Name : $"{item.Name} ({string.Join(", ", item.MetricNames)})"));

    sent.Select(static item => item.Name).ShouldContain("Request", $"the request's trace was sent; sent: {described}");
    sent.Select(static item => item.Name).ShouldContain("Message", $"the log line written during the request was sent; sent: {described}");
    sent.SelectMany(static item => item.MetricNames).ShouldAllBe(name => name == RESOURCE_RECORD, $"no metric is sent but the resource record; sent: {described}");
  }

  /// <summary>
  /// Never in practice (Aspire sets OTLP locally, Bicep sets Application Insights in production), but the two compose: each
  /// destination gets the traces. The OTLP endpoint is a local WireMock.Net server answering every request.
  /// </summary>
  [Test]
  public void With_OTLP_set_as_well_both_destinations_get_the_traces() {
    using WireMockServer otlp = WireMockServer.Start();
    otlp.Given(WireMockRequest.Create().UsingPost()).RespondWith(Response.Create().WithStatusCode(200));
    FakeIngestion ingestion;

    using (HostOnServiceDefaults host = new(Settings(
      (CONNECTION_STRING, MadeUpConnectionString()),
      (CLIENT_ID, MADE_UP_CLIENT_ID),
      ("OTEL_EXPORTER_OTLP_ENDPOINT", otlp.Url),
      ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf")))) {
      ingestion = host.Ingestion;
      host.RecordsOneOfEachSignal();
    }

    ingestion.Items.Select(static item => item.Name).ShouldContain("Request");
    otlp.LogEntries.Select(static entry => entry.RequestMessage?.Path).ShouldContain("/v1/traces");
  }

  /// <param name="clientId">Not declared at all; empty, as <c>appsettings.json</c> declares it; blank.</param>
  [Test]
  [Arguments(null)]
  [Arguments("")]
  [Arguments("   ")]
  public void With_the_connection_string_but_no_client_ID_the_app_does_not_start_and_the_message_names_only_the_setting(string? clientId) {
    Guid instrumentationKey = Guid.NewGuid();
    string connectionString = MadeUpConnectionString(instrumentationKey);

    InvalidOperationException error = Should.Throw<InvalidOperationException>(() => new HostOnServiceDefaults(Settings((CONNECTION_STRING, connectionString), (CLIENT_ID, clientId))));

    error.Message.ShouldContain(CLIENT_ID);
    error.Message.ShouldNotContain(connectionString);
    error.Message.ShouldNotContain(instrumentationKey.ToString(), Case.Insensitive);
    error.Message.ShouldNotContain("example.invalid");
  }

  /// <summary>The settings given, leaving out those given as <see langword="null"/> (not declared at all).</summary>
  private static Dictionary<string, string?> Settings(params (string Name, string? Value)[] settings) =>
    settings.Where(static setting => setting.Value is not null).ToDictionary(static setting => setting.Name, static setting => setting.Value);

  /// <summary>A made-up connection string: a new key, unless given, and an ingestion address in no Azure region.</summary>
  private static string MadeUpConnectionString(Guid? instrumentationKey = null) =>
    $"InstrumentationKey={instrumentationKey ?? Guid.NewGuid()};IngestionEndpoint=https://example.invalid/";

  [LoggerMessage(EventId = 1, Level = LogLevel.Information, Message = "A made-up line for the export check")]
  private static partial void LogMadeUpLine(ILogger logger);

  /// <summary>
  /// A host on the production service defaults with these settings (and nothing else: no environment variables, no
  /// files), whose Azure Monitor exporter, if any, sends to <see cref="Ingestion"/> with a made-up credential and no
  /// offline storage. Disposing it stops it: every provider then flushes what it holds.
  /// </summary>
  private sealed class HostOnServiceDefaults : IDisposable {
    private readonly IHost _host;
    private readonly HttpClientTransport _transport;

    public HostOnServiceDefaults(IReadOnlyDictionary<string, string?> settings) {
      HostApplicationBuilder builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings {
        ApplicationName = APPLICATION_NAME,
        EnvironmentName = Environments.Production,
      });

      builder.Configuration.AddInMemoryCollection(settings);
      builder.AddServiceDefaults();

      _transport = new HttpClientTransport(Ingestion);
      builder.Services.Configure<AzureMonitorExporterOptions>(options => {
        options.Transport = _transport;
        options.Credential = new MadeUpCredential();
        options.DisableOfflineStorage = true;
      });

      _host = builder.Build();
    }

    public FakeIngestion Ingestion { get; } = new();

    /// <summary>
    /// A request, as the app's own source records one when nobody upstream started a trace, with a log line written while
    /// it runs, as the app writes its bank lines; and the metrics the app's providers observe.
    /// </summary>
    public void RecordsOneOfEachSignal() {
      // Built first, so they listen before anything is recorded.
      _host.Services.GetRequiredService<TracerProvider>();
      _host.Services.GetRequiredService<MeterProvider>();

      ILogger logger = _host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("RevolutReader.TelemetryCheck");
      Activity? ambient = Activity.Current;

      // The test framework runs each test inside an activity of its own; a request would start its own trace.
      Activity.Current = null;

      try {
        using ActivitySource source = new(APPLICATION_NAME);
        using Activity? request = source.StartActivity("GET /made-up", ActivityKind.Server);

        request?.SetTag("http.request.method", "GET");
        request?.SetTag("http.response.status_code", 200);
        LogMadeUpLine(logger);
      }
      finally {
        Activity.Current = ambient;
      }
    }

    #region IDisposable

    public void Dispose() {
      _host.Dispose();
      _transport.Dispose();
      Ingestion.Dispose();
    }

    #endregion
  }

  /// <summary>Hands out a made-up token, so the exporter never asks the managed identity endpoint for one.</summary>
  private sealed class MadeUpCredential : TokenCredential {
    public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
      new("made-up-token", TimeProvider.System.GetUtcNow().AddHours(1));

    public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
      new(GetToken(requestContext, cancellationToken));
  }
}