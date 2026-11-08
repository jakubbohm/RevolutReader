using Azure.Core;
using Azure.Identity;
using Azure.Monitor.OpenTelemetry.Exporter;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace RevolutReader.ServiceDefaults;

/// <summary>
/// The Aspire service defaults, reduced for RevolutReader (c001 design.md D3, D5): OpenTelemetry
/// and service discovery stay. Two template parts are removed on purpose:
/// <list type="bullet">
/// <item>Health checks and <c>MapDefaultEndpoints</c>: the API serves its own <c>/health</c>
/// endpoint in every environment; a second route on the same path would clash.</item>
/// <item>The default resilience handler on every HttpClient: it retries 408, 429 and 5xx, and a
/// retried 429 from Enable Banking burns the 4 requests a day allowed without the account
/// holder (ADR-0001-bank-data-access). Each outgoing client decides its own policy.</item>
/// </list>
/// </summary>
public static class ServiceDefaultsExtensions {
  private const string HEALTH_ENDPOINT_PATH = "/health";

  /// <summary>The OTLP endpoint's standard setting name, set by Aspire locally.</summary>
  private const string OTLP_ENDPOINT = "OTEL_EXPORTER_OTLP_ENDPOINT";

  /// <summary>Application Insights' standard setting name for its connection string (c006 design.md D12).</summary>
  private const string APPLICATION_INSIGHTS_CONNECTION_STRING = "APPLICATIONINSIGHTS_CONNECTION_STRING";

  /// <summary>Azure.Identity's standard setting name for a user-assigned identity's client ID (c006 design.md D12).</summary>
  private const string AZURE_CLIENT_ID = "AZURE_CLIENT_ID";

  public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder {
    ArgumentNullException.ThrowIfNull(builder);

    builder.ConfigureOpenTelemetry();

    builder.Services.AddServiceDiscovery();

    builder.Services.ConfigureHttpClientDefaults(static http => http.AddServiceDiscovery());

    return builder;
  }

  public static TBuilder ConfigureOpenTelemetry<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder {
    ArgumentNullException.ThrowIfNull(builder);

    builder.Logging.AddOpenTelemetry(static logging => {
      logging.IncludeFormattedMessage = true;
      logging.IncludeScopes = true;
    });

    builder.Services.AddOpenTelemetry()
      .WithMetrics(static metrics => metrics.AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation())
      .WithTracing(tracing => tracing.AddSource(builder.Environment.ApplicationName)
        // Health probes would flood the traces.
        .AddAspNetCoreInstrumentation(static options => options.Filter = static context => !context.Request.Path.StartsWithSegments(HEALTH_ENDPOINT_PATH, StringComparison.Ordinal))
        // A request whose URL must not be exported (c004 design.md D5) is left out.
        .AddHttpClientInstrumentation(static options => options.FilterHttpRequestMessage = static request => !HttpRequestTracing.IsExcluded(request)));

    builder.AddOpenTelemetryExporters();

    return builder;
  }

  /// <summary>
  /// The destinations: OTLP when <see cref="OTLP_ENDPOINT"/> is set (Aspire, locally); Application Insights when
  /// <see cref="APPLICATION_INSIGHTS_CONNECTION_STRING"/> is set (production, c006 design.md D8 b). Both may be set at once:
  /// each only adds its exporters to the same pipeline. Neither: nothing leaves the app (tests).
  /// </summary>
  private static TBuilder AddOpenTelemetryExporters<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder {
    bool useOtlpExporter = !string.IsNullOrWhiteSpace(builder.Configuration[OTLP_ENDPOINT]);

    if (useOtlpExporter)
      builder.Services.AddOpenTelemetry().UseOtlpExporter();

    string? connectionString = builder.Configuration[APPLICATION_INSIGHTS_CONNECTION_STRING];

    if (!string.IsNullOrWhiteSpace(connectionString))
      builder.AddAzureMonitorExporters(connectionString);

    return builder;
  }

  /// <summary>
  /// The Azure Monitor exporter for traces and logs only, never metrics (c006 design.md D10), so per signal rather than
  /// <c>UseAzureMonitorExporter()</c>, which registers metrics and live metrics too. It writes with the app's user-assigned
  /// managed identity (<see cref="AZURE_CLIENT_ID"/>), since Application Insights accepts no key (D8 b); without that
  /// setting the app does not start. The message names the setting, never a value.
  /// </summary>
  private static void AddAzureMonitorExporters(this IHostApplicationBuilder builder, string connectionString) {
    string? clientId = builder.Configuration[AZURE_CLIENT_ID];

    if (string.IsNullOrWhiteSpace(clientId))
      throw new InvalidOperationException($"{APPLICATION_INSIGHTS_CONNECTION_STRING} is set but {AZURE_CLIENT_ID} is not: the app writes to Application Insights with its managed identity, whose client ID {AZURE_CLIENT_ID} must hold.");

    TokenCredential credential = new ManagedIdentityCredential(ManagedIdentityId.FromUserAssignedClientId(clientId));

    builder.Services.AddOpenTelemetry()
      .WithTracing(tracing => tracing.AddAzureMonitorTraceExporter(options => ConfigureAzureMonitor(options, connectionString), credential))
      .WithLogging(logging => logging.AddAzureMonitorLogExporter(options => ConfigureAzureMonitor(options, connectionString), credential));
  }

  /// <summary>
  /// Where to send, and nothing the decisions left out (c006 design.md D8, D10): the trace exporter's own metrics (standard
  /// metrics and performance counters, sent as metrics every minute) are off; every trace is kept, where the exporter's
  /// default would keep at most 5 a second; and every log line is kept: the exporter's trace-based log filter, there for
  /// sampling, compares the trace flags for exactly "recorded", so it would drop each line written inside a request whose
  /// flags also carry "random trace id", as .NET 11's activities do.
  /// </summary>
  private static void ConfigureAzureMonitor(AzureMonitorExporterOptions options, string connectionString) {
    options.ConnectionString = connectionString;
    options.EnableStandardMetrics = false;
    options.EnablePerformanceCounters = false;
    options.TracesPerSecond = null;
    options.SamplingRatio = 1.0F;
    options.EnableTraceBasedLogsSampler = false;
  }
}