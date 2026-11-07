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

  private static TBuilder AddOpenTelemetryExporters<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder {
    bool useOtlpExporter = !string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]);

    if (useOtlpExporter)
      builder.Services.AddOpenTelemetry().UseOtlpExporter();

    return builder;
  }
}