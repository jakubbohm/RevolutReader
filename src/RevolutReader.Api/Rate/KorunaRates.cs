namespace RevolutReader.Api.Rate;

/// <summary>
/// The rate an answer carries (c017 design.md D2–D7, D9): a singleton holding the kept rate and the ask in flight.
/// <list type="bullet">
/// <item>The kept rate is read from the store once per instance, on the first call, and held in memory after it (D2).</item>
/// <item>While a rate is not due (<see cref="RateAsking.IsDue"/>), the kept one is answered and the CNB is not asked
/// (D3).</item>
/// <item>While one is due, the call asks the CNB, sharing the ask in flight with every caller that comes while it runs
/// (<see cref="SharedAsk"/>, D4). A rate for a later day than the kept one is held, logged as kept
/// (<see cref="RateLog.KorunaRateKept"/>, D7) and answered, and saved in the store after the answer, off the callers' path
/// (<see cref="SaveInTheBackground"/>), so the shared ask ends within the CNB's time limit whatever the store takes; one
/// for the kept day or an earlier one changes nothing, the kept one is answered, and nothing is logged (D2, D6, D7), so the
/// next call asks again while the rate is due. After a failed first read the save first reads the row, and writes only
/// when the row is missing or for an earlier day, so an earlier day's rate never replaces the store's (review of PR #95,
/// finding 3).</item>
/// <item>Never fails for the CNB or the store (D5): a failed ask answers the kept rate, or the app's own when none is kept;
/// a store that fails is logged (<see cref="RateLog.KorunaRateStoreFailed"/>), its read counting as nothing kept, its write
/// ignored. A save cut off when the app stops is harmless: the next process reads the older row and asks again. Only the
/// caller's own cancellation ends its call.</item>
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
  /// The kept rate: read from the store on this instance's first call that reads it and learned (<see cref="LearnTheRow"/>),
  /// the one held in memory after it. A read that fails, in whatever way, is logged and counts as nothing kept, and the next
  /// call reads again (D5); only the caller's own cancellation passes on.
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

    return LearnTheRow(read);
  }

  /// <summary>
  /// The store's row (<paramref name="row"/>, <see langword="null"/> for none), read successfully, learned once per
  /// instance: while the store counts as unread, memory takes the row's rate only when it holds none or the row is for a
  /// later day, and the store counts as read. A read never replaces a rate held meanwhile for the same or a later day (a
  /// rate an ask kept after a failed read); once the store counts as read, a later read changes nothing, so of two first
  /// reads at the same time the one that ends first counts. Answers the rate held after it.
  /// </summary>
  private KorunaRate? LearnTheRow(KorunaRate? row) {
    lock (_lock) {
      if (!_keptWasRead) {
        _kept = _kept is { } held && (row is null || held.Date >= row.Date) ? held : row;
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
      KorunaRate rate => KeptOrNewer(rate),
      CnbFailed failed => AfterAFailedAsk(failed),
    };

  /// <summary>
  /// <paramref name="answered"/>, held in memory, its save started (<see cref="SaveInTheBackground"/>), logged as kept and
  /// answered at once, when nothing is kept or it is for a later day than the kept rate (D2, D7); otherwise the kept rate,
  /// with nothing saved and nothing logged: the kept day's rate again, or an earlier day's, which only a stale copy in front
  /// of the CNB could send (D6). The save is not awaited: the shared ask every caller awaits ends with the CNB's answer,
  /// within its time limit, never held by a slow store (D4; review of PR #95, finding 4). After a failed first read, memory
  /// knows no kept rate to compare with, so the save compares with the store's row first and writes only over an earlier
  /// day's or none (<see cref="SaveInTheBackground"/>; review of PR #95, finding 3); this call still answers the CNB's rate.
  /// </summary>
  private KorunaRate KeptOrNewer(KorunaRate answered) {
    lock (_lock) {
      if (_kept is { } kept && answered.Date <= kept.Date)
        return kept;

      _kept = answered;
    }

    _ = SaveInTheBackground(answered);
    RateLog.KorunaRateKept(logger, answered.CzkPerEur, answered.Date);

    return answered;
  }

  /// <summary>
  /// The one place the kept rate is saved: <paramref name="rate"/> into the store, on no caller's token, after its answer
  /// and off the callers' path. Started from <see cref="KeptOrNewer"/> and not awaited there, so a store that answers at
  /// once has saved before the call returns, and a slow one holds no caller.
  /// <list type="bullet">
  /// <item>While this instance has not read the store successfully (its first read failed), the row is read first and
  /// learned as <see cref="Kept"/> learns it (<see cref="LearnTheRow"/>), and the rate is written only when the row is
  /// missing or for an earlier day: the rule that only a later day's rate replaces the kept one holds for the store too,
  /// not only for memory (D2, D6; review of PR #95, finding 3). The next calls then answer the row's rate when it is the
  /// later one. A read that fails here is logged and the save skipped: the rate stays held and answered, and a later
  /// process reads the older row and asks again (D5).</item>
  /// <item>Once the store was read, the rate is written as it is: memory already held the row's, and the rate is later.</item>
  /// </list>
  /// It never faults: a read or save that fails, in whatever way, is logged and ignored, the rate still held and answered
  /// (D5). A save cut off when the app stops is harmless too: the next process reads the older row and asks again.
  /// </summary>
  private async Task SaveInTheBackground(KorunaRate rate) {
    bool storeWasRead;

    lock (_lock)
      storeWasRead = _keptWasRead;

    if (!storeWasRead) {
      KorunaRate? row;

      try {
        row = await store.Read(CancellationToken.None);
      }
#pragma warning disable CA1031 // A store that fails to read, in whatever way, never fails a request and never faults unobserved (D5): the read runs on no caller's token, so no failure of it is a caller's cancellation.
      catch (Exception exception) {
        RateLog.KorunaRateStoreFailed(logger, READ, exception);

        return;
      }
#pragma warning restore CA1031

      _ = LearnTheRow(row);

      if (row is not null && row.Date >= rate.Date)
        return;
    }

    try {
      await store.Save(rate, CancellationToken.None);
    }
#pragma warning disable CA1031 // A store that fails to write, in whatever way, never fails a request and never faults unobserved (D5): the save runs on no caller's token, so no failure of it is a caller's cancellation.
    catch (Exception exception) {
      RateLog.KorunaRateStoreFailed(logger, WRITTEN, exception);
    }
#pragma warning restore CA1031
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