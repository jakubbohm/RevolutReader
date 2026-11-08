namespace RevolutReader.Api.Account;

/// <summary>A transaction as the app shows it (c010 design.md D10).</summary>
/// <param name="Date">The day it is dated by.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Pending">Whether the bank has not settled it yet.</param>
/// <param name="Counterparty">The payee for money spent, the payer for money received; may be missing.</param>
/// <param name="Details">The bank's text as the app shows it.</param>
/// <param name="Kind">The kind, from the bank's type code.</param>
public sealed record ShownTransaction(
  DateOnly Date,
  decimal Amount,
  string Currency,
  bool Pending,
  string? Counterparty,
  IReadOnlyList<string> Details,
  TransactionKind Kind);

/// <summary>A page of transactions as the app shows it (c010 design.md D10).</summary>
/// <param name="Transactions">In the page's order.</param>
/// <param name="OlderBefore">The day before which older transactions are kept; <see langword="null"/> when none are.</param>
/// <param name="CzkPerEur">The koruna rate.</param>
/// <param name="RateDate">The rate's date.</param>
public sealed record TransactionPage(
  IReadOnlyList<ShownTransaction> Transactions,
  DateOnly? OlderBefore,
  decimal CzkPerEur,
  DateOnly RateDate);