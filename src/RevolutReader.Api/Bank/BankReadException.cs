using System.Globalization;
using System.Net;

namespace RevolutReader.Api.Bank;

/// <summary>Bugs and misconfiguration (c004 design.md D4's "everything else"): HTTP status and error code only, never a URL or a body.</summary>
public sealed class BankReadException : Exception {
  public BankReadException() {
  }

  public BankReadException(string message) : base(message) {
  }

  public BankReadException(string message, Exception innerException) : base(message, innerException) {
  }

  /// <summary>An error answer a read has no case for (D4): the message names its status and error code, nothing else (D5).</summary>
  public BankReadException(HttpStatusCode status, string? errorCode) : base(MessageFor(status, errorCode)) {
  }

  private static string MessageFor(HttpStatusCode status, string? errorCode) =>
    string.Create(CultureInfo.InvariantCulture, $"Enable Banking answered {(int)status} with {(errorCode is null ? "no error code" : $"the error code {errorCode}")}, which a read has no case for.");
}