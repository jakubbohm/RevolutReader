namespace RevolutReader.Api.Push;

/// <summary>What one delivery came to (c011 design.md D3, D13).</summary>
public union DeliveryOutcome(Delivered, DeviceGone, DeliveryFailed);

/// <summary>The push service took the push.</summary>
public sealed record Delivered;

/// <summary>The push service reports the device gone (404, 410).</summary>
public sealed record DeviceGone(int Status);

/// <summary>Any other failure: another status, or none when no answer came (timeout, no connection).</summary>
public sealed record DeliveryFailed(int? Status);