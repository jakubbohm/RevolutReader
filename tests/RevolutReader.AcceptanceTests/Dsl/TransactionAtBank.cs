namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction as the bank lists it (spec bank-reads, GIVEN). Whatever a scenario does not give is absent at the bank:
/// no counterparty, no reference, no payment details. The type code is the factory's default for its kind of transaction
/// unless the scenario names one (<see langword="null"/>: none). The driver writes it in the shape of the Mock ASPSP
/// capture.
/// </summary>
/// <param name="Status">The bank's status: booked, pending, cancelled or rejected.</param>
/// <param name="Flow">Money out (spent) or in (received).</param>
/// <param name="Amount">As the bank states it: positive, the direction is <paramref name="Flow"/>.</param>
/// <param name="Currency">The amount's currency.</param>
/// <param name="Day">The one day the bank gives the transaction: its booking day when booked, its transaction day otherwise.</param>
/// <param name="Counterparty">The payee of money out, the payer of money in.</param>
/// <param name="Reference">The bank's entry reference.</param>
/// <param name="Details">The bank's payment details.</param>
/// <param name="TypeCode">The bank's code for the kind of transaction (<c>bank_transaction_code.code</c>, c010 design.md D4).</param>
public sealed record TransactionAtBank(
  StatusAtBank Status,
  MoneyFlow Flow,
  decimal Amount,
  string Currency,
  DateOnly Day,
  string? Counterparty,
  string? Reference,
  Lines Details,
  string? TypeCode) {
  public const string DEFAULT_CURRENCY = "EUR";

  /// <summary>
  /// The type codes the factories give by default: three of the codes in the M1 history file (counts only, c010 design.md
  /// § Context), and the refund code Revolut's API reference lists (D4c), which the history never showed.
  /// </summary>
  public const string CARD_PAYMENT = "CARD_PAYMENT";
  public const string TRANSFER = "TRANSFER";
  public const string ATM = "ATM";
  public const string CARD_REFUND = "CARD_REFUND";

  /// <summary>Money spent: a payment of <paramref name="amount"/> on <paramref name="on"/>, to <paramref name="to"/>; type code <see cref="CARD_PAYMENT"/> by default.</summary>
  public static TransactionAtBank Payment(StatusAtBank status, decimal amount, DateOnly on, string? to = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY, string? typeCode = CARD_PAYMENT) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.Out, amount, currency, on, to, reference, details ?? Lines.None, typeCode);
  }

  /// <summary>Money received: a transfer of <paramref name="amount"/> on <paramref name="on"/>, from <paramref name="from"/>; type code <see cref="TRANSFER"/> by default.</summary>
  public static TransactionAtBank TransferReceived(StatusAtBank status, decimal amount, DateOnly on, string? from = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY, string? typeCode = TRANSFER) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.In, amount, currency, on, from, reference, details ?? Lines.None, typeCode);
  }

  /// <summary>Money received back: a refund of <paramref name="amount"/> on <paramref name="on"/>, from <paramref name="from"/>; type code <see cref="CARD_REFUND"/> by default.</summary>
  public static TransactionAtBank Refund(StatusAtBank status, decimal amount, DateOnly on, string? from = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY, string? typeCode = CARD_REFUND) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.In, amount, currency, on, from, reference, details ?? Lines.None, typeCode);
  }

  /// <summary>Cash taken out: a withdrawal of <paramref name="amount"/> on <paramref name="on"/>, at <paramref name="at"/> when the bank names one; type code <see cref="ATM"/> by default.</summary>
  public static TransactionAtBank CashWithdrawal(StatusAtBank status, decimal amount, DateOnly on, string? at = null, string? reference = null, Lines? details = null, string currency = DEFAULT_CURRENCY, string? typeCode = ATM) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(amount);

    return new(status, MoneyFlow.Out, amount, currency, on, at, reference, details ?? Lines.None, typeCode);
  }
}

/// <summary>A transaction's status at the bank; only booked and pending ones come back from a read.</summary>
public enum StatusAtBank {
  Booked,
  Pending,
  Cancelled,
  Rejected,
}

/// <summary>Which way the money went.</summary>
public enum MoneyFlow {
  Out,
  In,
}