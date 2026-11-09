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
  TransactionKind Kind) {
  /// <summary>
  /// A transaction from the bank or the store as the app shows it, the newest page's or an older one's: the bank's text as
  /// the app shows it (<see cref="TransactionText"/>, D4b) and its kind from the type code (<see cref="TransactionKinds"/>,
  /// D4); whether it is pending is the caller's to say.
  /// </summary>
  internal static ShownTransaction Of(
    DateOnly date,
    decimal amount,
    string currency,
    bool pending,
    string? counterparty,
    IReadOnlyList<string> paymentDetails,
    string? typeCode) => new(
      date,
      amount,
      currency,
      pending,
      counterparty,
      TransactionText.Details(counterparty, paymentDetails),
      TransactionKinds.Of(typeCode));
}

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