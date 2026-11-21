namespace RevolutReader.Api.Rate;

/// <summary>
/// The rate an answer carries (c017 design.md D2–D5, D7, D9): a singleton holding the kept rate.
/// <list type="bullet">
/// <item>The kept rate is read from the store once per instance, on the first call, and held in memory after it (D2).</item>
/// <item>While a rate is not due (<see cref="RateAsking.IsDue"/>), the kept one is answered and the CNB is not asked
/// (D3).</item>
/// <item>While one is due, the call asks the CNB; the rate it answers is held, saved in the store, logged as kept
/// (<see cref="RateLog.KorunaRateKept"/>, D7) and answered (D2, D3).</item>
/// </list>
/// </summary>
public sealed class KorunaRates(ICnbRates cnb, IKorunaRateStore store, TimeProvider time, ILogger<KorunaRates> logger) : IKorunaRates {
  /// <summary>Guards <see cref="_keptWasRead"/> and <see cref="_kept"/>.</summary>
  private readonly Lock _lock = new();

  /// <summary>Whether this instance has read the kept rate from the store yet.</summary>
  private bool _keptWasRead;

  /// <summary>The kept rate, held in memory; <see langword="null"/> while none is kept or before the store was read.</summary>
  private KorunaRate? _kept;

  public async Task<KorunaRate> Current(CancellationToken cancellationToken) {
    KorunaRate? kept = await Kept(cancellationToken);

    if (!RateAsking.IsDue(kept, time.GetUtcNow()))
      return kept;

#pragma warning disable CA1508 // Its flow analysis calls the rate's arm always true, as in AccountCheck's union switch; each case is named, so a case added to the union later is a compile error rather than a silent default.
    return await cnb.ReadEuroRate(cancellationToken) switch {
      KorunaRate rate => await Keep(rate, cancellationToken),
      CnbFailed => throw new NotImplementedException("A failed ask is handled in tasks.md 21.1 (c017 design.md D5)."),
    };
#pragma warning restore CA1508
  }

  /// <summary>
  /// The kept rate: read from the store on this instance's first call, the one held in memory after it. Of two first calls
  /// at the same time, the read that ends first counts, so a later read never replaces a rate held meanwhile.
  /// </summary>
  private async Task<KorunaRate?> Kept(CancellationToken cancellationToken) {
    lock (_lock) {
      if (_keptWasRead)
        return _kept;
    }

    KorunaRate? read = await store.Read(cancellationToken);

    lock (_lock) {
      if (!_keptWasRead) {
        _kept = read;
        _keptWasRead = true;
      }

      return _kept;
    }
  }

  /// <summary><paramref name="rate"/> held in memory, saved in the store (D2) and logged as kept (D7); answered.</summary>
  private async Task<KorunaRate> Keep(KorunaRate rate, CancellationToken cancellationToken) {
    lock (_lock)
      _kept = rate;

    await store.Save(rate, cancellationToken);
    RateLog.KorunaRateKept(logger, rate.CzkPerEur, rate.Date);

    return rate;
  }
}