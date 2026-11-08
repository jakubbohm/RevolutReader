namespace RevolutReader.Api.Account;

/// <summary>A settled transaction as kept (c010 design.md D5).</summary>
/// <param name="Reference">The bank's entry reference, the transaction's key.</param>
/// <param name="Date">The day it is dated by.</param>
/// <param name="Position">Its place within its day in the bank's order, 0 first.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Counterparty">The payee for money spent, the payer for money received; may be missing.</param>
/// <param name="PaymentDetails">The bank's lines, unchanged; may be none.</param>
/// <param name="TypeCode">The bank's type code, unchanged; may be missing.</param>
public sealed record KeptTransaction(
  string Reference,
  DateOnly Date,
  int Position,
  decimal Amount,
  string Currency,
  string? Counterparty,
  IReadOnlyList<string> PaymentDetails,
  string? TypeCode);