namespace RevolutReader.Api.Check;

/// <summary>
/// The account check's log lines (c014 design.md D15), source-generated: what a check came to and counts only; never an
/// amount, a balance, a time read, an email address or a key.
/// </summary>
public static partial class CheckLog {
  /// <summary>What a check came to.</summary>
  [LoggerMessage(EventName = "CheckEnded", Level = LogLevel.Information, Message = "An account check ended: {End}")]
  public static partial void CheckEnded(ILogger logger, CheckEnd end);

  /// <summary>A change sent to every allowed account: how many accounts, each counted once whatever its letter case, and the devices reached, failed and kept, and removed as gone, summed.</summary>
  [LoggerMessage(EventName = "ChangeSent", Level = LogLevel.Information, Message = "A change was sent to {Accounts} accounts: {Delivered} devices reached, {Failed} failed and were kept, {Removed} were removed as gone")]
  public static partial void ChangeSent(ILogger logger, int accounts, int delivered, int failed, int removed);

  /// <summary>
  /// A check that recorded no first-seen times, with why (c018 design.md D5): a bank failure of its transactions read, by
  /// its kind. The same event as <see cref="FirstSeenNotRecordedWithException"/>, its message the same, so a query on the
  /// event finds both (as c017's <c>KorunaRateAskFailed</c>).
  /// </summary>
  [LoggerMessage(EventName = "FirstSeenNotRecorded", Level = LogLevel.Warning, Message = "An account check recorded no first-seen times: {Failure}")]
  public static partial void FirstSeenNotRecorded(ILogger logger, FirstSeenFailure failure);

  /// <summary>A check that recorded no first-seen times because of an exception (<see cref="FirstSeenFailure.Failed"/>), with the exception; exceptions carry no bank data (README.md § Backend code).</summary>
#pragma warning disable LOGGEN027 // One event, FirstSeenNotRecorded, in two forms: with and without the exception. The shared name is deliberate, so a query on the event finds every check that recorded nothing (c018 design.md § Public API sketch).
  [LoggerMessage(EventName = "FirstSeenNotRecorded", Level = LogLevel.Warning, Message = "An account check recorded no first-seen times: {Failure}")]
  public static partial void FirstSeenNotRecordedWithException(ILogger logger, FirstSeenFailure failure, Exception exception);
#pragma warning restore LOGGEN027

  /// <summary>A check that threw; exceptions carry no bank data (README.md § Backend code).</summary>
  [LoggerMessage(EventName = "CheckFailed", Level = LogLevel.Error, Message = "An account check failed")]
  public static partial void CheckFailed(ILogger logger, Exception exception);
}