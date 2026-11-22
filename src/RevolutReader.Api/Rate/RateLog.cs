namespace RevolutReader.Api.Rate;

/// <summary>
/// The koruna rate's log lines (c017 design.md D7), source-generated. The rate is public data, not bank data, so a line may
/// hold it in full. Nothing is logged for an ask that returns the rate already kept, or an earlier day's.
/// </summary>
internal static partial class RateLog {
  /// <summary>A rate for a later day than the kept one, or the first, was kept: about once per working day.</summary>
  [LoggerMessage(EventName = "KorunaRateKept", Level = LogLevel.Information, Message = "A new koruna rate was kept: {CzkPerEur} CZK per euro for {Date}")]
  public static partial void KorunaRateKept(ILogger logger, decimal czkPerEur, DateOnly date);

  /// <summary>
  /// An ask of the CNB that failed in a way with no status code (<see cref="CnbFailure.NoAnswerInTime"/>,
  /// <see cref="CnbFailure.Unreachable"/>, <see cref="CnbFailure.Unreadable"/>), with its kind: one per request during an
  /// outage. The same event as <see cref="KorunaRateAskFailedWithStatus"/>, its message the same up to the kind, so a query
  /// on either finds both; it has no status part (review of PR #95, finding 5).
  /// </summary>
  [LoggerMessage(EventName = "KorunaRateAskFailed", Level = LogLevel.Warning, Message = "Asking the CNB for the koruna rate failed: {Kind}")]
  public static partial void KorunaRateAskFailed(ILogger logger, CnbFailure kind);

  /// <summary>An ask of the CNB answered with a status but 200 (<see cref="CnbFailure.Status"/>), with its kind and the code.</summary>
#pragma warning disable LOGGEN027 // One event, KorunaRateAskFailed, in two forms: with and without the status code. The shared name is deliberate, so a query on the event finds every failed ask (D7; review of PR #95, finding 5).
  [LoggerMessage(EventName = "KorunaRateAskFailed", Level = LogLevel.Warning, Message = "Asking the CNB for the koruna rate failed: {Kind}, status {StatusCode}")]
  public static partial void KorunaRateAskFailedWithStatus(ILogger logger, CnbFailure kind, int statusCode);
#pragma warning restore LOGGEN027

  /// <summary>The kept row could not be <paramref name="operation"/> (<c>read</c> or <c>written</c>), with the store's exception (D5).</summary>
  [LoggerMessage(EventName = "KorunaRateStoreFailed", Level = LogLevel.Warning, Message = "The kept koruna rate could not be {Operation}")]
  public static partial void KorunaRateStoreFailed(ILogger logger, string operation, Exception exception);
}