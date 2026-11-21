using System.ComponentModel;

namespace RevolutReader.Api.Push;

/// <summary>
/// A push's arrival on this device (spec push-arrivals, c016 design.md D2, D3): the read time the push's balance carried,
/// as the push gave it; optional, so a missing one reaches the endpoint rather than fail binding. The descriptions are the
/// API description's.
/// </summary>
[Description("A push's arrival on this device, named by the read time its balance carried")]
public sealed record ArrivalReportRequest {
  [Description("When the server read the balance the push carried, exactly as the push gave it")]
  public DateTimeOffset? ReadAt { get; init; }
}