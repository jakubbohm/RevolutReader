using System.ComponentModel;

namespace RevolutReader.Api.Push;

/// <summary>
/// A device's push subscription as the browser gives it (c011 design.md D9): <c>PushSubscription.toJSON()</c>'s members,
/// each optional here, so a missing one is the handler's refusal, never a binding failure. <c>expirationTime</c> is read
/// and ignored. The descriptions are the API description's, in plain words.
/// </summary>
[Description("A device's push subscription, as the browser's PushSubscription.toJSON() gives it")]
public sealed record SubscriptionRequest {
  [Description("The device's push address, at its push service")]
  public string? Endpoint { get; init; }

  [Description("When the subscription expires, as the browser gives it; not used")]
  public double? ExpirationTime { get; init; }

  [Description("The device's keys for encrypting its pushes")]
  public SubscriptionKeys? Keys { get; init; }
}

/// <summary>The subscription's two keys (D9), each base64url without padding.</summary>
[Description("The device's keys for encrypting its pushes, each base64url without padding")]
public sealed record SubscriptionKeys {
  [Description("The device's P-256 public key, the uncompressed point (65 bytes)")]
  public string? P256dh { get; init; }

  [Description("The device's secret (16 bytes)")]
  public string? Auth { get; init; }
}