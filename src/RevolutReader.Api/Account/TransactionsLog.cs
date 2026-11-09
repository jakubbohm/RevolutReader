namespace RevolutReader.Api.Account;

/// <summary>
/// The transactions' log lines (c010 design.md D3, D4c, D5), source-generated: numbers and code-shaped type codes only,
/// never bank data (no counterparty, amount or line of the bank's text).
/// </summary>
public static partial class TransactionsLog {
  /// <summary>
  /// The newest kept day is earlier than the 89 days the live read reaches back to (D3): the days between it and the read's
  /// start are lost unless a history file covers them. Only the gap's days, never bank data.
  /// </summary>
  [LoggerMessage(EventName = "HistoryGap", Level = LogLevel.Warning, Message = "The newest kept transaction is {Days} days old, more than the live read's 89 days reach back: the days in between are missing unless a history file covers them")]
  public static partial void HistoryGap(ILogger logger, int days);

  /// <summary>Settled transactions without a reference, which have no key to be kept by: shown, not kept (D5). Only their count, never bank data.</summary>
  [LoggerMessage(EventName = "SettledWithoutReference", Level = LogLevel.Warning, Message = "{Count} settled transactions came without a reference: shown, but not kept")]
  public static partial void SettledWithoutReference(ILogger logger, int count);

  /// <summary>A type code the app does not know, which looks like a code, so it is quoted: the first sign of a code to add (D4c).</summary>
  [LoggerMessage(EventName = "UnknownTypeCode", Level = LogLevel.Warning, Message = "A transaction has a type code the app does not know: {Code}")]
  public static partial void UnknownTypeCode(ILogger logger, string code);

  /// <summary>
  /// A code-shaped type code containing REFUND, shown as a refund on a guess (D4c): logged, quoted, until the first real
  /// refund in the logs confirms the guess; then this line goes.
  /// </summary>
  [LoggerMessage(EventName = "RefundTypeCode", Level = LogLevel.Warning, Message = "A transaction has a type code containing REFUND, shown as a refund: {Code}")]
  public static partial void RefundTypeCode(ILogger logger, string code);

  /// <summary>A type code the app does not know that does not look like a code: never quoted, the bank could have put anything there (D4c).</summary>
  [LoggerMessage(EventName = "TypeCodeNotLikeACode", Level = LogLevel.Warning, Message = "A transaction has a type code the app does not know, which does not look like a code; not quoted")]
  public static partial void TypeCodeNotLikeACode(ILogger logger);

  /// <summary>A transaction without a type code: its kind is other (D4c).</summary>
  [LoggerMessage(EventName = "NoTypeCode", Level = LogLevel.Warning, Message = "A transaction has no type code")]
  public static partial void NoTypeCode(ILogger logger);
}