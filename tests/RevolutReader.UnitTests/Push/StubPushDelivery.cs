using RevolutReader.Api.Push;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// A hand-written stub of <see cref="IPushDelivery"/> for the sender's unit tests (c011 design.md § Ports and contracts:
/// the push services have no in-memory fake): every push is delivered, unless the test told the stub what a device's push
/// service answers instead (<see cref="Answers"/>), and each one handed over is recorded with its device, in the order
/// handed over. Safe for calls from several threads at once, as the sender sends to all devices at once.
/// </summary>
public sealed class StubPushDelivery : IPushDelivery {
  private readonly Lock _lock = new();
  private readonly List<(PushDevice Device, OutgoingPush Push)> _handedOver = [];
  private readonly Dictionary<string, DeliveryOutcome> _answers = new(StringComparer.Ordinal);

  /// <summary>Every push handed over, with the device it was for, in the order handed over.</summary>
  public IReadOnlyList<(PushDevice Device, OutgoingPush Push)> HandedOver {
    get {
      lock (_lock)
        return [.. _handedOver];
    }
  }

  /// <summary>From now on, every push to <paramref name="device"/>'s push address comes to <paramref name="outcome"/> instead of being delivered.</summary>
  public StubPushDelivery Answers(PushDevice device, DeliveryOutcome outcome) {
    ArgumentNullException.ThrowIfNull(device);

    lock (_lock)
      _answers[device.Endpoint] = outcome;

    return this;
  }

  public Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(device);
    ArgumentNullException.ThrowIfNull(push);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      _handedOver.Add((device, push));

      return Task.FromResult(_answers.TryGetValue(device.Endpoint, out DeliveryOutcome outcome) ? outcome : new Delivered());
    }
  }
}