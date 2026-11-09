namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as a read returns it (spec bank-reads, "What a transaction carries"): exactly these seven fields and its
/// type code (<see cref="TypeCode"/>), compared by value (the details line by line).
/// <para>
/// The type code is compared only where a scenario names one (<see cref="WithTypeCode"/>): a read always states it, so a
/// scenario that names no type code makes no claim about it (c010: the field joined the requirement, and the scenarios
/// from before it stay as they are). Otherwise every field counts.
/// </para>
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

  /// <summary>The bank's code for the kind of transaction, unchanged; <see langword="null"/> when the bank gave none. Meaningful only when <see cref="TypeCodeStated"/>.</summary>
  public string? TypeCode { get; private init; }

  /// <summary>Whether <see cref="TypeCode"/> is stated: always for what a read returned; for a scenario's value only after <see cref="WithTypeCode"/>.</summary>
  public bool TypeCodeStated { get; private init; }

  /// <summary>A booked transaction of <paramref name="amount"/> (signed) <paramref name="currency"/> on <paramref name="on"/>.</summary>
  public static TransactionSeen Booked(decimal amount, string currency, DateOnly on, string? reference = null, string? counterparty = null, Lines? details = null) =>
    new(reference, STATUS_BOOKED, on, amount, currency, counterparty, details ?? Lines.None);

  /// <summary>A pending transaction of <paramref name="amount"/> (signed) <paramref name="currency"/> on <paramref name="on"/>.</summary>
  public static TransactionSeen Pending(decimal amount, string currency, DateOnly on, string? reference = null, string? counterparty = null, Lines? details = null) =>
    new(reference, STATUS_PENDING, on, amount, currency, counterparty, details ?? Lines.None);

  /// <summary>This transaction with its type code stated: <paramref name="typeCode"/>, or none (<see langword="null"/>).</summary>
  public TransactionSeen WithTypeCode(string? typeCode) => this with { TypeCode = typeCode, TypeCodeStated = true };

  #region Object overrides

  /// <summary>Every field by value; the type code only when both sides state it.</summary>
  public bool Equals(TransactionSeen? other) =>
    other is not null
    && Reference == other.Reference
    && Status == other.Status
    && Date == other.Date
    && Amount == other.Amount
    && Currency == other.Currency
    && Counterparty == other.Counterparty
    && Details.Equals(other.Details)
    && (!TypeCodeStated || !other.TypeCodeStated || TypeCode == other.TypeCode);

  public override int GetHashCode() => HashCode.Combine(Reference, Status, Date, Amount, Currency, Counterparty, Details);

  #endregion
}