namespace RevolutReader.Api.Push;

/// <summary>The push services (c011 design.md § Ports and contracts). Never retries; the caller's cancellation throws.</summary>
public interface IPushDelivery {
  Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken);
}