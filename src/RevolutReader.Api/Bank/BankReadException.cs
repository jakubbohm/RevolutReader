namespace RevolutReader.Api.Bank;

/// <summary>Bugs and misconfiguration (c004 design.md D4's "everything else"): HTTP status and error code only, never a URL or a body.</summary>
public sealed class BankReadException : Exception {
  public BankReadException() {
  }

  public BankReadException(string message) : base(message) {
  }

  public BankReadException(string message, Exception innerException) : base(message, innerException) {
  }
}