namespace RevolutReader.Api.Push;

/// <summary>A device as the browser describes it (c011 design.md D9): PushSubscription.toJSON()'s members.</summary>
public sealed record DeviceSubscription(string? Endpoint, string? P256dh, string? Auth);