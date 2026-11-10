namespace RevolutReader.Api.Push;

/// <summary>The device store (c011 design.md § Ports and contracts, D11).</summary>
public interface IPushDeviceStore {
  Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken);

  /// <summary>Inserts or replaces the device by its push address; saving it under another account moves it.</summary>
  Task Save(PushDevice device, CancellationToken cancellationToken);

  /// <summary>Deletes the device with this push address; none stored is fine.</summary>
  Task Forget(string endpoint, CancellationToken cancellationToken);
}