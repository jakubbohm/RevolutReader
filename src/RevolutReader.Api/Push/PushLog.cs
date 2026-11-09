namespace RevolutReader.Api.Push;

/// <summary>
/// Push's log lines (c011 design.md D4), source-generated: counts, statuses and outcomes only; never a message's title,
/// text or page, an account, or a device's push address or keys.
/// </summary>
public static partial class PushLog {
  /// <summary>A message sent to an account's devices: how many it reached, how many failed and were kept, how many were removed as gone.</summary>
  [LoggerMessage(EventName = "PushSent", Level = LogLevel.Information, Message = "A push message reached {Delivered} devices; {Failed} failed and were kept, {Removed} were removed as gone")]
  public static partial void PushSent(ILogger logger, int delivered, int failed, int removed);
}