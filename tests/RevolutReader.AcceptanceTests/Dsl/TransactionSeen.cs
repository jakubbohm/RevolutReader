namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as a read returns it (spec bank-reads, "What a transaction carries"): exactly these seven fields,
/// compared by value (the details line by line).
/// </summary>
/// <param name="Reference">The bank's reference; missing while pending, or when the bank gave none.</param>
/// <param name="Status"><see cref="STATUS_BOOKED"/> or <see cref="STATUS_PENDING"/>.</param>
/// <param name="Date">The day the transaction is dated by.</param>
/// <param name="Amount">Negative for money spent, positive for money received.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Counterparty">The payee of money spent, the payer of money received; may be missing.</param>
/// <param name="Details">The payment details, unchanged; possibly none.</param>
public sealed record TransactionSeen(string? Reference, string Status, DateOnly Date, decimal Amount, string Currency, string? Counterparty, Lines Details) {
  public const string STATUS_BOOKED = "booked";
  public const string STATUS_PENDING = "pending";

  /// <summary>A booked transaction of <paramref name="amount"/> (signed) <paramref name="currency"/> on <paramref name="on"/>.</summary>
  public static TransactionSeen Booked(decimal amount, string currency, DateOnly on, string? reference = null, string? counterparty = null, Lines? details = null) =>
    new(reference, STATUS_BOOKED, on, amount, currency, counterparty, details ?? Lines.None);

  /// <summary>A pending transaction of <paramref name="amount"/> (signed) <paramref name="currency"/> on <paramref name="on"/>.</summary>
  public static TransactionSeen Pending(decimal amount, string currency, DateOnly on, string? reference = null, string? counterparty = null, Lines? details = null) =>
    new(reference, STATUS_PENDING, on, amount, currency, counterparty, details ?? Lines.None);
}