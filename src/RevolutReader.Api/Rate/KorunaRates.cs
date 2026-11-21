namespace RevolutReader.Api.Rate;

/// <summary>
/// The rate an answer carries (c017 design.md D2–D7, D9): a singleton holding the kept rate and the ask in flight.
/// <list type="bullet">
/// <item>The kept rate is read from the store once per instance, on the first call, and held in memory after it (D2).</item>
/// <item>While a rate is not due (<see cref="RateAsking.IsDue"/>), the kept one is answered and the CNB is not asked
/// (D3).</item>
/// <item>While one is due, the call asks the CNB, sharing the ask in flight with every caller that comes while it runs
/// (<see cref="SharedAsk"/>, D4). A rate for a later day than the kept one is held, saved in the store, logged as kept
/// (<see cref="RateLog.KorunaRateKept"/>, D7) and answered; one for the kept day or an earlier one changes nothing, the
/// kept one is answered, and nothing is logged (D2, D6, D7), so the next call asks again while the rate is due.</item>
/// </list>
/// </summary>
public sealed class KorunaRates(ICnbRates cnb, IKorunaRateStore store, TimeProvider time, ILogger<KorunaRates> logger) : IKorunaRates {
  /// <summary>Guards <see cref="_keptWasRead"/>, <see cref="_kept"/> and <see cref="_asking"/>.</summary>
  private readonly Lock _lock = new();

  /// <summary>Whether this instance has read the kept rate from the store yet.</summary>
  private bool _keptWasRead;

  /// <summary>The kept rate, held in memory; <see langword="null"/> while none is kept or before the store was read.</summary>
  private KorunaRate? _kept;

  /// <summary>The last ask started; shared while it runs, never once it has ended; <see langword="null"/> before the first.</summary>
  private Task<KorunaRate>? _asking;

  public async Task<KorunaRate> Current(CancellationToken cancellationToken) {
    KorunaRate? kept = await Kept(cancellationToken);

    if (!RateAsking.IsDue(kept, time.GetUtcNow()))
      return kept;

    return await SharedAsk().WaitAsync(cancellationToken);
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

  /// <summary>
  /// The ask in flight, which every caller that comes while it runs awaits; a new one when none runs, as
  /// <c>Storage/TableCreation</c> shares its creation (D4). An ask that has ended, whether it answered or threw, is never
  /// shared, so the next caller asks anew while the rate is due. The ask runs on no caller's token: each caller stops
  /// waiting on its own (<see cref="Current"/>), so one that leaves never ends it for the others.
  /// </summary>
  private Task<KorunaRate> SharedAsk() {
    lock (_lock) {
      if (_asking is null || _asking.IsCompleted)
        _asking = AskAndKeep();

      return _asking;
    }
  }

  /// <summary>One ask of the CNB, and its rate kept when it is for a later day (<see cref="KeptOrNewer"/>); on no caller's token (D4).</summary>
  private async Task<KorunaRate> AskAndKeep() {
#pragma warning disable CA1508 // Its flow analysis calls the rate's arm always true, as in AccountCheck's union switch; each case is named, so a case added to the union later is a compile error rather than a silent default.
    return await cnb.ReadEuroRate(CancellationToken.None) switch {
      KorunaRate rate => await KeptOrNewer(rate),
      CnbFailed => throw new NotImplementedException("A failed ask is handled in tasks.md 21.1 (c017 design.md D5)."),
    };
#pragma warning restore CA1508
  }

  /// <summary>
  /// <paramref name="answered"/>, held in memory, saved in the store and logged as kept, when nothing is kept or it is for a
  /// later day than the kept rate (D2, D7); otherwise the kept rate, with nothing saved and nothing logged: the kept day's
  /// rate again, or an earlier day's, which only a stale copy in front of the CNB could send (D6).
  /// </summary>
  private async Task<KorunaRate> KeptOrNewer(KorunaRate answered) {
    lock (_lock) {
      if (_kept is { } kept && answered.Date <= kept.Date)
        return kept;

      _kept = answered;
    }

    await store.Save(answered, CancellationToken.None);
    RateLog.KorunaRateKept(logger, answered.CzkPerEur, answered.Date);

    return answered;
  }
}