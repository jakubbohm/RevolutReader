namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as the API answers it (spec account-transactions, c010 design.md D10; <c>seenAt</c> since c018 design.md
/// D4, D10): its eight fields, compared by value (the details line by line). The currency is not part of it: every
/// scenario's transactions are in euros, and the driver (<see cref="Drivers.TransactionsDriver"/>) checks that the answer
/// says <c>EUR</c>. The date and the approximate time are the scenario's (<see cref="Drivers.ScenarioCalendar"/>).
/// </summary>
/// <param name="Date">The day the transaction is dated by.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Pending">Whether the bank has not settled it yet.</param>
/// <param name="Counterparty">The payee of money spent, the payer of money received; may be missing.</param>
/// <param name="Details">The bank's text as the app shows it: no blank line, no line repeating the counterparty.</param>
/// <param name="Kind">The kind, as the answer names it: one of <see cref="CARD"/>, <see cref="TOPUP"/>, <see cref="TRANSFER"/>, <see cref="ATM"/>, <see cref="EXCHANGE"/>, <see cref="REFUND"/>, <see cref="OTHER"/>.</param>
/// <param name="SeenAt">
/// Its approximate time, <c>seenAt</c>: when the app first got it from the bank, in UTC to the whole second, the date
/// shifted as <paramref name="Date"/> is; <see langword="null"/> when the answer gives none.
/// </param>
public sealed record TransactionSeenInApi(DateOnly Date, decimal Amount, bool Pending, string? Counterparty, Lines Details, string Kind, DateTimeOffset? SeenAt = null) {
  /// <summary>The kinds as the answer names them: the design system's <c>TxKind</c> names (D10).</summary>
  public const string CARD = "card";
  public const string TOPUP = "topup";
  public const string TRANSFER = "transfer";
  public const string ATM = "atm";
  public const string EXCHANGE = "exchange";
  public const string REFUND = "refund";
  public const string OTHER = "other";

  /// <summary>A settled transaction of <paramref name="amount"/> (signed) EUR on <paramref name="on"/>; a card payment unless the scenario names another kind; no approximate time unless it names one (<paramref name="seenAt"/>, UTC).</summary>
  public static TransactionSeenInApi Settled(decimal amount, DateOnly on, string? counterparty = null, Lines? details = null, string kind = CARD, DateTimeOffset? seenAt = null) =>
    new(on, amount, Pending: false, counterparty, details ?? Lines.None, kind, seenAt);

  /// <summary>A pending transaction of <paramref name="amount"/> (signed) EUR on <paramref name="on"/>; a card payment unless the scenario names another kind; no approximate time unless it names one (<paramref name="seenAt"/>, UTC).</summary>
  public static TransactionSeenInApi StillPending(decimal amount, DateOnly on, string? counterparty = null, Lines? details = null, string kind = CARD, DateTimeOffset? seenAt = null) =>
    new(on, amount, Pending: true, counterparty, details ?? Lines.None, kind, seenAt);
}