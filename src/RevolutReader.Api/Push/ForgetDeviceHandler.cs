namespace RevolutReader.Api.Push;

/// <summary>
/// Forgets the device with this push address (spec push-devices, c011 design.md D9, D11): the device stored under exactly
/// that address, compared as stored, is deleted; none stored, or no address, is fine. Logs nothing of its own (D4).
/// </summary>
public sealed class ForgetDeviceHandler(IPushDeviceStore store) {
  /// <summary>Forgets the device stored under <paramref name="endpoint"/>, as the class describes.</summary>
  public Task Handle(string? endpoint, CancellationToken cancellationToken) =>
    endpoint is null ? Task.CompletedTask : store.Forget(endpoint, cancellationToken);
}