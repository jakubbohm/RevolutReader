namespace RevolutReader.Api.Push;

/// <summary>
/// Push's log lines (c011 design.md D4), source-generated: counts, statuses and outcomes only; never a message's title,
/// text or page, an account, or a device's push address or keys.
/// </summary>
public static partial class PushLog {
  /// <summary>A message sent to an account's devices: how many it reached, how many failed and were kept, how many were removed as gone.</summary>
  [LoggerMessage(EventName = "PushSent", Level = LogLevel.Information, Message = "A push message reached {Delivered} devices; {Failed} failed and were kept, {Removed} were removed as gone")]
  public static partial void PushSent(ILogger logger, int delivered, int failed, int removed);

  /// <summary>A push that failed and whose device was kept: the push service's status, or none when no answer came; never the device.</summary>
  [LoggerMessage(EventName = "PushDeliveryFailed", Level = LogLevel.Warning, Message = "A push failed with status {Status}; the device was kept")]
  public static partial void PushDeliveryFailed(ILogger logger, int? status);

  /// <summary>A device its push service reports gone (404, 410), forgotten: the push service's status only, never the device.</summary>
  [LoggerMessage(EventName = "PushDeviceGone", Level = LogLevel.Information, Message = "A push service reported a device gone with status {Status}; the device was forgotten")]
  public static partial void PushDeviceGone(ILogger logger, int status);

  /// <summary>A message refused because its account is not on the allowlist: how many of the account's devices were deleted. Never the account.</summary>
  [LoggerMessage(EventName = "PushAccountNotAllowed", Level = LogLevel.Warning, Message = "A push message was refused: its account is not on the allowlist; {Removed} of its devices were deleted")]
  public static partial void PushAccountNotAllowed(ILogger logger, int removed);
}