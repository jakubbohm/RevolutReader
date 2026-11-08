namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as the API answers it (spec account-transactions, c010 design.md D10): its seven fields, compared by
/// value (the details line by line). The currency is not part of it: every scenario's transactions are in euros, and the
/// driver (<see cref="Drivers.TransactionsDriver"/>) checks that the answer says <c>EUR</c>. The date is the scenario's
/// (<see cref="Drivers.ScenarioCalendar"/>).
/// </summary>
/// <param name="Date">The day the transaction is dated by.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Pending">Whether the bank has not settled it yet.</param>
/// <param name="Counterparty">The payee of money spent, the payer of money received; may be missing.</param>
/// <param name="Details">The bank's text as the app shows it: no blank line, no line repeating the counterparty.</param>
/// <param name="Kind">The kind, as the answer names it: one of <see cref="CARD"/>, <see cref="TOPUP"/>, <see cref="TRANSFER"/>, <see cref="ATM"/>, <see cref="EXCHANGE"/>, <see cref="REFUND"/>, <see cref="OTHER"/>.</param>
public sealed record TransactionSeenInApi(DateOnly Date, decimal Amount, bool Pending, string? Counterparty, Lines Details, string Kind) {
  /// <summary>The kinds as the answer names them: the design system's <c>TxKind</c> names (D10).</summary>
  public const string CARD = "card";
  public const string TOPUP = "topup";
  public const string TRANSFER = "transfer";
  public const string ATM = "atm";
  public const string EXCHANGE = "exchange";
  public const string REFUND = "refund";
  public const string OTHER = "other";

  /// <summary>A settled transaction of <paramref name="amount"/> (signed) EUR on <paramref name="on"/>; a card payment unless the scenario names another kind.</summary>
  public static TransactionSeenInApi Settled(decimal amount, DateOnly on, string? counterparty = null, Lines? details = null, string kind = CARD) =>
    new(on, amount, Pending: false, counterparty, details ?? Lines.None, kind);

  /// <summary>A pending transaction of <paramref name="amount"/> (signed) EUR on <paramref name="on"/>; a card payment unless the scenario names another kind.</summary>
  public static TransactionSeenInApi StillPending(decimal amount, DateOnly on, string? counterparty = null, Lines? details = null, string kind = CARD) =>
    new(on, amount, Pending: true, counterparty, details ?? Lines.None, kind);
}