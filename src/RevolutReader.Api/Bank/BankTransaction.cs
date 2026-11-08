namespace RevolutReader.Api.Bank;

/// <summary>
/// A booked or pending transaction, with exactly the fields of spec bank-reads (c004 design.md D3), the bank's type code
/// among them (c010 design.md § Public API sketch).
/// </summary>
/// <param name="Reference">The bank's entry reference; may be missing while pending.</param>
/// <param name="Status">Booked or pending.</param>
/// <param name="Date">The transaction date, else the booking date, else the value date.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Counterparty">The payee for money spent, the payer for money received; may be missing.</param>
/// <param name="PaymentDetails">The bank's lines, unchanged and in order; may be none.</param>
/// <param name="TypeCode">The bank's type code (<c>bank_transaction_code.code</c>), unchanged; may be missing.</param>
public sealed record BankTransaction(
  string? Reference,
  TransactionStatus Status,
  DateOnly Date,
  decimal Amount,
  string Currency,
  string? Counterparty,
  IReadOnlyList<string> PaymentDetails,
  string? TypeCode);