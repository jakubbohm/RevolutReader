using RevolutReader.Api.Push;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The push device store in memory (c011 design.md § Ports and contracts, D11): the in-memory fake of
/// <see cref="IPushDeviceStore"/> the handlers' unit tests use. The integration project compiles this same file into its
/// contract tests, which run it and the Table adapter against the same tests, so it stays self-contained: it needs nothing
/// from either test project.
/// <list type="bullet">
/// <item><see cref="ReadAll"/>: every stored device, in no promised order (here the order they were first saved); an
/// empty store reads as no devices. Every field comes back as saved, the push address unchanged.</item>
/// <item><see cref="Save"/>: inserts or replaces the device by its push address, compared exactly (ordinal), whole: saving
/// the same address again leaves one device with the latest keys and account.</item>
/// <item><see cref="Forget"/>: deletes the device with that push address; an address not stored does nothing.</item>
/// <item>Safe for calls from several threads at once (a send forgets gone devices while it sends to the others).</item>
/// </list>
/// </summary>
public sealed class InMemoryPushDeviceStore : IPushDeviceStore {
  private readonly Lock _lock = new();
  private readonly List<PushDevice> _devices = [];

  public Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken) {
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock)
      return Task.FromResult<IReadOnlyList<PushDevice>>([.. _devices]);
  }

  public Task Save(PushDevice device, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(device);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      int stored = _devices.FindIndex(kept => string.Equals(kept.Endpoint, device.Endpoint, StringComparison.Ordinal));

      if (stored < 0)
        _devices.Add(device);
      else
        _devices[stored] = device;
    }

    return Task.CompletedTask;
  }

  public Task Forget(string endpoint, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(endpoint);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock)
      _ = _devices.RemoveAll(kept => string.Equals(kept.Endpoint, endpoint, StringComparison.Ordinal));

    return Task.CompletedTask;
  }
}