using System.ComponentModel.DataAnnotations;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Rate;

/// <summary>The <c>Cnb</c> section (c017 design.md D1, D4), validated on start: where the CNB's API is and how long one ask may take.</summary>
public sealed class CnbOptions {
  public const string SECTION = "Cnb";

  /// <summary>
  /// The API's base address: https://api.cnb.cz in production and locally; the fake's loopback address in tests. An absolute
  /// https address, or plain http on a loopback host, checked at start by <see cref="CnbOptionsValidator"/>.
  /// </summary>
  [Required]
  public required Uri Address { get; init; }

  /// <summary>
  /// How long one ask may take: 2 s (D4), the named client's <see cref="HttpClient.Timeout"/>; 1 ms to 10 s.
  /// <see cref="TimeSpanRangeAttribute"/> reads the limits in the invariant culture, whatever the server's, so the
  /// millisecond's decimal point always parses.
  /// </summary>
  [TimeSpanRange("00:00:00.001", "00:00:10")]
  public required TimeSpan TimeLimit { get; init; }
}