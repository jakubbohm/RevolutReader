using System.ComponentModel;

namespace RevolutReader.Api.Push;

/// <summary>
/// The device to forget, named by its push address as the browser's subscription gives it (c011 design.md D9); optional,
/// so a request without it forgets nothing rather than fail binding. The description is the API description's.
/// </summary>
[Description("The device to forget, named by its push address")]
public sealed record ForgetSubscriptionRequest {
  [Description("The device's push address, as its subscription gives it")]
  public string? Endpoint { get; init; }
}