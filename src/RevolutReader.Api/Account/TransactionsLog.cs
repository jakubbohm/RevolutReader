namespace RevolutReader.Api.Account;

/// <summary>
/// The transactions' log lines (c010 design.md D3, D4c, D5), source-generated: numbers and code-shaped type codes only,
/// never bank data (no counterparty, amount or line of the bank's text).
/// </summary>
public static partial class TransactionsLog {
  /// <summary>A type code the app does not know, which looks like a code, so it is quoted: the first sign of a code to add (D4c).</summary>
  [LoggerMessage(EventName = "UnknownTypeCode", Level = LogLevel.Warning, Message = "A transaction has a type code the app does not know: {Code}")]
  public static partial void UnknownTypeCode(ILogger logger, string code);

  /// <summary>A type code the app does not know that does not look like a code: never quoted, the bank could have put anything there (D4c).</summary>
  [LoggerMessage(EventName = "TypeCodeNotLikeACode", Level = LogLevel.Warning, Message = "A transaction has a type code the app does not know, which does not look like a code; not quoted")]
  public static partial void TypeCodeNotLikeACode(ILogger logger);

  /// <summary>A transaction without a type code: its kind is other (D4c).</summary>
  [LoggerMessage(EventName = "NoTypeCode", Level = LogLevel.Warning, Message = "A transaction has no type code")]
  public static partial void NoTypeCode(ILogger logger);
}