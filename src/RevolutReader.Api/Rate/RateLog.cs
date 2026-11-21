namespace RevolutReader.Api.Rate;

/// <summary>
/// The koruna rate's log lines (c017 design.md D7), source-generated. The rate is public data, not bank data, so a line may
/// hold it in full. Nothing is logged for an ask that returns the rate already kept, or an earlier day's.
/// </summary>
internal static partial class RateLog {
  /// <summary>A rate for a later day than the kept one, or the first, was kept: about once per working day.</summary>
  [LoggerMessage(EventName = "KorunaRateKept", Level = LogLevel.Information, Message = "A new koruna rate was kept: {CzkPerEur} CZK per euro for {Date}")]
  public static partial void KorunaRateKept(ILogger logger, decimal czkPerEur, DateOnly date);

  /// <summary>An ask of the CNB that failed, with its kind and, for a status, the code: one per request during an outage.</summary>
  [LoggerMessage(EventName = "KorunaRateAskFailed", Level = LogLevel.Warning, Message = "Asking the CNB for the koruna rate failed: {Kind}, status {StatusCode}")]
  public static partial void KorunaRateAskFailed(ILogger logger, CnbFailure kind, int? statusCode);

  /// <summary>The kept row could not be <paramref name="operation"/> (<c>read</c> or <c>written</c>), with the store's exception (D5).</summary>
  [LoggerMessage(EventName = "KorunaRateStoreFailed", Level = LogLevel.Warning, Message = "The kept koruna rate could not be {Operation}")]
  public static partial void KorunaRateStoreFailed(ILogger logger, string operation, Exception exception);
}