using System.Net;

namespace RevolutReader.Api.Bank;

/// <summary>What an error answer from the bank means for a read (c004 design.md D4).</summary>
public enum BankErrorKind {
  /// <summary>First, so the default value fails safe: a slip that returns it ends as an exception, not as a result.</summary>
  Unexpected,
  AccessExpired,
  RateLimited,
  Unavailable,
}

/// <summary>D4's table: from Enable Banking's error answer to the read's outcome.</summary>
public static class BankErrorClassification {
  /// <summary>
  /// D4's table: the error code decides; the status only when the body has no code. Codes are compared exactly as the API
  /// reference writes them (ordinal, upper case): any other spelling is an unknown code, so unexpected. A blank code
  /// (<see langword="null"/>, empty or whitespace) is no code.
  /// </summary>
  public static BankErrorKind Classify(HttpStatusCode status, string? errorCode) =>
    string.IsNullOrWhiteSpace(errorCode) ? ByStatus(status) : ByCode(errorCode);

  private static BankErrorKind ByCode(string errorCode) => errorCode switch {
    // Only the owner can fix these, by linking the account again: the session expired, was revoked or closed, or is
    // unknown; the bank wants the account holder; or the access to the account is gone.
    "EXPIRED_SESSION" or "REVOKED_SESSION" or "CLOSED_SESSION" or "SESSION_DOES_NOT_EXIST"
      or "ASPSP_PSU_ACTION_REQUIRED" or "NO_ACCOUNTS_ADDED" or "ASPSP_ACCOUNT_NOT_ACCESSIBLE" => BankErrorKind.AccessExpired,
    // The bank's request limit: never retried (ADR-0001).
    "ASPSP_RATE_LIMIT_EXCEEDED" => BankErrorKind.RateLimited,
    // The bank's own error or timeout: a result the screen offers a retry for.
    "ASPSP_ERROR" or "ASPSP_TIMEOUT" => BankErrorKind.Unavailable,
    _ => BankErrorKind.Unexpected,
  };

  /// <summary>
  /// An answer without a code: 429 is the rate limit; any server error (5xx) and 408 are the bank unavailable; any other
  /// status is unexpected.
  /// </summary>
  private static BankErrorKind ByStatus(HttpStatusCode status) => (int)status switch {
    429 => BankErrorKind.RateLimited,
    408 or (>= 500 and <= 599) => BankErrorKind.Unavailable,
    _ => BankErrorKind.Unexpected,
  };
}