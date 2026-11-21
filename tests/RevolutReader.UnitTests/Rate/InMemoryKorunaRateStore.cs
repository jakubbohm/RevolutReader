using RevolutReader.Api.Rate;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The kept koruna rate in memory (c017 design.md § Ports and contracts, D2): the in-memory fake of
/// <see cref="IKorunaRateStore"/> the rate service's unit tests use. The integration project compiles this same file into
/// its contract tests (tasks.md 6.2), which run it and the Table adapter against the same tests, so it stays
/// self-contained: it needs nothing from either test project.
/// <list type="bullet">
/// <item><see cref="Read"/>: the rate as last saved, exactly (the decimal with its scale, the day);
/// <see langword="null"/> when nothing was ever saved. Each read is counted (<see cref="Reads"/>), so a test sees how often
/// the service read the kept rate.</item>
/// <item><see cref="Save"/>: replaces the kept rate, whole; the last write wins. Each save is counted
/// (<see cref="Saves"/>), so a test sees whether the service saved a rate, even one equal to the kept one.</item>
/// <item>Safe for calls from several threads at once.</item>
/// </list>
/// </summary>
public sealed class InMemoryKorunaRateStore : IKorunaRateStore {
  private readonly Lock _lock = new();
  private KorunaRate? _kept;
  private int _reads;
  private int _saves;

  /// <summary>How many times the kept rate was read so far.</summary>
  public int Reads {
    get {
      lock (_lock)
        return _reads;
    }
  }

  /// <summary>How many times a rate was saved so far.</summary>
  public int Saves {
    get {
      lock (_lock)
        return _saves;
    }
  }

  public Task<KorunaRate?> Read(CancellationToken cancellationToken) {
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      _reads++;

      return Task.FromResult(_kept);
    }
  }

  public Task Save(KorunaRate rate, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(rate);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      _kept = rate;
      _saves++;
    }

    return Task.CompletedTask;
  }
}