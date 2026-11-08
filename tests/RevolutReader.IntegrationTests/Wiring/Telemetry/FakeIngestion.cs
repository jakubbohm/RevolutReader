using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json;

namespace RevolutReader.IntegrationTests.Wiring.Telemetry;

/// <summary>
/// Application Insights' ingestion endpoint, faked as the HTTP handler behind the Azure Monitor exporter's transport: it
/// keeps every telemetry item it is sent (its kind, such as <c>Request</c>, <c>Message</c> or <c>Metric</c>, and a metric
/// item's metric names) and answers that it accepted them all. Nothing it is handed leaves the process.
/// </summary>
public sealed class FakeIngestion : HttpMessageHandler {
  private readonly Lock _lock = new();
  private readonly List<SentItem> _items = [];
  private int _requests;

  /// <summary>How many requests the exporter sent.</summary>
  public int Requests {
    get {
      lock (_lock)
        return _requests;
    }
  }

  /// <summary>Every telemetry item sent so far, in order.</summary>
  public IReadOnlyList<SentItem> Items {
    get {
      lock (_lock)
        return [.. _items];
    }
  }

  protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(request);

    byte[] body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
    string[] lines = Encoding.UTF8.GetString(Decompressed(body)).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    List<SentItem> items = [.. lines.Select(ItemOf)];

    lock (_lock) {
      _requests++;
      _items.AddRange(items);
    }

    return new HttpResponseMessage(HttpStatusCode.OK) {
      Content = new StringContent($$"""{ "itemsReceived": {{items.Count}}, "itemsAccepted": {{items.Count}}, "errors": [] }""", Encoding.UTF8, "application/json"),
    };
  }

  /// <summary>The body as sent, or unzipped when it is gzip (its first two bytes say so).</summary>
  private static byte[] Decompressed(byte[] body) {
    if (body.Length < 2 || body[0] != 0x1F || body[1] != 0x8B)
      return body;

    using GZipStream unzip = new(new MemoryStream(body), CompressionMode.Decompress);
    using MemoryStream plain = new();

    unzip.CopyTo(plain);

    return plain.ToArray();
  }

  /// <summary>One telemetry item, a JSON line: its <c>name</c>, and for a metric item the names in <c>data.baseData.metrics</c>.</summary>
  private static SentItem ItemOf(string line) {
    using JsonDocument document = JsonDocument.Parse(line);
    JsonElement item = document.RootElement;
    string name = item.GetProperty("name").GetString() ?? string.Empty;
    List<string> metricNames = [];

    if (item.TryGetProperty("data", out JsonElement data) && data.TryGetProperty("baseData", out JsonElement baseData)
      && baseData.TryGetProperty("metrics", out JsonElement metrics) && metrics.ValueKind == JsonValueKind.Array) {
      foreach (JsonElement metric in metrics.EnumerateArray())
        metricNames.Add(metric.GetProperty("name").GetString() ?? string.Empty);
    }

    return new SentItem(name, metricNames);
  }
}

/// <summary>One telemetry item the exporter sent.</summary>
/// <param name="Name">Its kind: <c>Request</c>, <c>RemoteDependency</c>, <c>Message</c>, <c>Exception</c>, <c>Metric</c>, …</param>
/// <param name="MetricNames">For a metric item, the names of its metrics; otherwise none.</param>
public sealed record SentItem(string Name, IReadOnlyList<string> MetricNames);