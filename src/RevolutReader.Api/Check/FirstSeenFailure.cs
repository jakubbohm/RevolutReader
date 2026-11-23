namespace RevolutReader.Api.Check;

/// <summary>Why a check recorded no first-seen times (c018 design.md D5).</summary>
public enum FirstSeenFailure {
  /// <summary>The bank's access has expired: the transactions read answered <c>BankAccessExpired</c>.</summary>
  BankAccessExpired,

  /// <summary>The bank's request limit was reached: the transactions read answered <c>BankRateLimited</c>.</summary>
  BankRateLimited,

  /// <summary>The bank could not be read: the transactions read answered <c>BankUnavailable</c>.</summary>
  BankUnavailable,

  /// <summary>Any exception while reading or recording (storage, a bug), logged with the exception.</summary>
  Failed,
}