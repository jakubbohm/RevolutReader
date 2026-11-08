using System.Net.Http.Headers;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>Sends a header more than once, as some clients and proxies do (for the guards in <c>Conventions/</c>).</summary>
internal static class HeaderLines {
  /// <summary>
  /// Adds <paramref name="name"/> once per value, each its own header line, unvalidated. The app copy then sees one header
  /// with every value, apart (<c>StringValues.Count</c> equal to the number of values; checked on the test server,
  /// 2026-11-08, for <c>Origin</c> and <c>Sec-Fetch-Site</c>).
  /// </summary>
  public static void AddEachOnItsOwnLine(HttpRequestHeaders headers, string name, params string[] values) {
    ArgumentNullException.ThrowIfNull(headers);
    ArgumentNullException.ThrowIfNull(values);

    foreach (string value in values) {
      if (!headers.TryAddWithoutValidation(name, value))
        throw new InvalidOperationException($"The request header {name} could not be added.");
    }
  }
}