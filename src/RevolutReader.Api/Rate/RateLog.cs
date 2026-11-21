namespace RevolutReader.Api.Rate;

/// <summary>
/// The koruna rate's log lines (c017 design.md D7), source-generated. The rate is public data, not bank data, so a line may
/// hold it in full.
/// </summary>
internal static partial class RateLog {
  /// <summary>A rate the CNB answered was kept: about once per working day.</summary>
  [LoggerMessage(EventName = "KorunaRateKept", Level = LogLevel.Information, Message = "A new koruna rate was kept: {CzkPerEur} CZK per euro for {Date}")]
  public static partial void KorunaRateKept(ILogger logger, decimal czkPerEur, DateOnly date);
}