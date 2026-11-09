using RevolutReader.Api.Push;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// A hand-written stub of <see cref="IPushDelivery"/> for the sender's unit tests (c011 design.md § Ports and contracts:
/// the push services have no in-memory fake): every push is delivered, and each one handed over is recorded with its
/// device, in the order handed over. Safe for calls from several threads at once, as the sender sends to all devices at once.
/// </summary>
public sealed class StubPushDelivery : IPushDelivery {
  private readonly Lock _lock = new();
  private readonly List<(PushDevice Device, OutgoingPush Push)> _handedOver = [];

  /// <summary>Every push handed over, with the device it was for, in the order handed over.</summary>
  public IReadOnlyList<(PushDevice Device, OutgoingPush Push)> HandedOver {
    get {
      lock (_lock)
        return [.. _handedOver];
    }
  }

  public Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(device);
    ArgumentNullException.ThrowIfNull(push);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock)
      _handedOver.Add((device, push));

    return Task.FromResult<DeliveryOutcome>(new Delivered());
  }
}