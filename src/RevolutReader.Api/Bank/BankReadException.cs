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
  public BankReadException(HttpStatusCode status, string? errorCode)
    : base(MessageFor(status, errorCode is null ? "no error code" : $"the error code {errorCode}")) {
  }

  /// <summary>
  /// An error answer a read has no case for whose <c>error</c> value does not have the shape of a code (c006 design.md
  /// D7): the message names its status and says the value was unrecognised, never quoting it.
  /// </summary>
  public static BankReadException ForUnrecognisedErrorValue(HttpStatusCode status) => new(MessageFor(status, "an unrecognised error value"));

  private static string MessageFor(HttpStatusCode status, string answer) =>
    string.Create(CultureInfo.InvariantCulture, $"Enable Banking answered {(int)status} with {answer}, which a read has no case for.");
}