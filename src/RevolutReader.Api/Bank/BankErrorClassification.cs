using System.Net;

namespace RevolutReader.Api.Bank;

/// <summary>What an error answer from the bank means for a read (c004 design.md D4).</summary>
public enum BankErrorKind {
  AccessExpired,
  RateLimited,
  Unavailable,
  Unexpected,
}

/// <summary>D4's table: from Enable Banking's error answer to the read's outcome.</summary>
public static class BankErrorClassification {
  /// <summary>D4's table: the error code decides; the status only when the body has no code.</summary>
  public static BankErrorKind Classify(HttpStatusCode status, string? errorCode) => throw new NotImplementedException();
}