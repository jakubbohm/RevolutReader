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
/// <item>Never fails for the CNB or the store (D5): a failed ask answers the kept rate, or the app's own when none is kept;
/// a store that fails is logged (<see cref="RateLog.KorunaRateStoreFailed"/>), its read counting as nothing kept, its write
/// ignored. Only the caller's own cancellation ends its call.</item>
/// </list>
/// </summary>
public sealed class KorunaRates(ICnbRates cnb, IKorunaRateStore store, TimeProvider time, ILogger<KorunaRates> logger) : IKorunaRates {
  /// <summary>The store's operations as <see cref="RateLog.KorunaRateStoreFailed"/> names them: "could not be read", "could not be written".</summary>
  private const string READ = "read";
  private const string WRITTEN = "written";

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
  /// The kept rate: read from the store on this instance's first call that reads it, the one held in memory after it. A
  /// read that fails, in whatever way, is logged and counts as nothing kept, and the next call reads again (D5); only the
  /// caller's own cancellation passes on. A read never replaces a rate held meanwhile for the same or a later day: of two
  /// first calls at the same time the read that ends first counts, and after a failed read the rate an ask kept stays
  /// unless the store's is for a later day.
  /// </summary>
  private async Task<KorunaRate?> Kept(CancellationToken cancellationToken) {
    lock (_lock) {
      if (_keptWasRead)
        return _kept;
    }

    KorunaRate? read;

    try {
      read = await store.Read(cancellationToken);
    }
#pragma warning disable CA1031 // A store that fails to read, in whatever way, counts as nothing kept and never fails the request (D5); only the caller's own cancellation passes.
    catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested) {
      RateLog.KorunaRateStoreFailed(logger, READ, exception);

      lock (_lock)
        return _kept;
    }
#pragma warning restore CA1031

    lock (_lock) {
      if (!_keptWasRead) {
        _kept = _kept is { } held && (read is null || held.Date >= read.Date) ? held : read;
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

  /// <summary>
  /// One ask of the CNB, on no caller's token (D4): its rate kept when it is for a later day (<see cref="KeptOrNewer"/>), or
  /// its failure handled (<see cref="AfterAFailedAsk"/>).
  /// </summary>
  private async Task<KorunaRate> AskAndKeep() =>
    await cnb.ReadEuroRate(CancellationToken.None) switch {
      KorunaRate rate => await KeptOrNewer(rate),
      CnbFailed failed => AfterAFailedAsk(failed),
    };

  /// <summary>
  /// <paramref name="answered"/>, held in memory, saved in the store and logged as kept, when nothing is kept or it is for a
  /// later day than the kept rate (D2, D7); otherwise the kept rate, with nothing saved and nothing logged: the kept day's
  /// rate again, or an earlier day's, which only a stale copy in front of the CNB could send (D6). A save that fails, in
  /// whatever way, is logged and ignored: the rate is still held, logged as kept and answered (D5); the next process reads
  /// the older row and asks again.
  /// </summary>
  private async Task<KorunaRate> KeptOrNewer(KorunaRate answered) {
    lock (_lock) {
      if (_kept is { } kept && answered.Date <= kept.Date)
        return kept;

      _kept = answered;
    }

    try {
      await store.Save(answered, CancellationToken.None);
    }
#pragma warning disable CA1031 // A store that fails to write, in whatever way, never fails the request (D5): the save runs on no caller's token, so no failure of it is a caller's cancellation.
    catch (Exception exception) {
      RateLog.KorunaRateStoreFailed(logger, WRITTEN, exception);
    }
#pragma warning restore CA1031

    RateLog.KorunaRateKept(logger, answered.CzkPerEur, answered.Date);

    return answered;
  }

  /// <summary>
  /// A failed ask (D5): logged with its kind, and the status code for a status (D7); answered with the kept rate, or with
  /// <see cref="KorunaRate.AppsOwn"/> when none is kept, which is never kept, so the next call asks again. Not retried: the
  /// next call asks again while the rate is due.
  /// </summary>
  private KorunaRate AfterAFailedAsk(CnbFailed failed) {
    RateLog.KorunaRateAskFailed(logger, failed.Kind, failed.StatusCode);

    lock (_lock)
      return _kept ?? KorunaRate.AppsOwn;
  }
}