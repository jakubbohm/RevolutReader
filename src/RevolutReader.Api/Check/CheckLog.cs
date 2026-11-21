namespace RevolutReader.Api.Check;

/// <summary>
/// The account check's log lines (c014 design.md D15), source-generated: what a check came to and counts only; never an
/// amount, a balance, a time read, an email address or a key.
/// </summary>
public static partial class CheckLog {
  /// <summary>What a check came to.</summary>
  [LoggerMessage(EventName = "CheckEnded", Level = LogLevel.Information, Message = "An account check ended: {End}")]
  public static partial void CheckEnded(ILogger logger, CheckEnd end);

  /// <summary>A change sent to every allowed account: how many accounts, and the devices reached, failed and kept, and removed as gone, summed.</summary>
  [LoggerMessage(EventName = "ChangeSent", Level = LogLevel.Information, Message = "A change was sent to {Accounts} accounts: {Delivered} devices reached, {Failed} failed and were kept, {Removed} were removed as gone")]
  public static partial void ChangeSent(ILogger logger, int accounts, int delivered, int failed, int removed);

  /// <summary>A check that threw; exceptions carry no bank data (README.md § Backend code).</summary>
  [LoggerMessage(EventName = "CheckFailed", Level = LogLevel.Error, Message = "An account check failed")]
  public static partial void CheckFailed(ILogger logger, Exception exception);
}