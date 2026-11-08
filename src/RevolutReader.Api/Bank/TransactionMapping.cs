namespace RevolutReader.Api.Bank;

/// <summary>
/// From the bank's transactions to the port's (c004 design.md D3). A transaction it cannot read is a
/// <see cref="BankReadException"/> (D4 "everything else"), whose text names what is wrong and quotes nothing from the
/// bank (D5).
/// </summary>
public static class TransactionMapping {
  /// <summary>The bank's status of a booked transaction.</summary>
  private const string BOOKED = "BOOK";

  /// <summary>The bank's status of a pending transaction.</summary>
  private const string PENDING = "PDNG";

  /// <summary>The bank's other statuses (API reference): cancelled, rejected, on hold, scheduled, other. Left out (D3).</summary>
  private const string CANCELLED = "CNCL";
  private const string REJECTED = "RJCT";
  private const string ON_HOLD = "HOLD";
  private const string SCHEDULED = "SCHD";
  private const string OTHER = "OTHR";

  /// <summary>The bank's credit/debit indicator of money spent.</summary>
  private const string MONEY_SPENT = "DBIT";

  /// <summary>The bank's credit/debit indicator of money received.</summary>
  private const string MONEY_RECEIVED = "CRDT";

  /// <summary>
  /// Booked and pending kept and mapped, in the bank's order (D3). The other five statuses the API reference defines are
  /// left out and only counted: none of such a transaction's other fields is read, its amount neither. Any other status
  /// is an error. The bank's amounts carry no sign, the direction is in the credit/debit indicator: a kept transaction
  /// whose amount is negative is an error that quotes no amount, and a zero amount comes out as zero, never as a negative
  /// zero (spec bank-reads § What a transaction carries; c006 design.md D2).
  /// </summary>
  public static MappedTransactions Map(IEnumerable<EbTransaction> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    List<BankTransaction> kept = [];
    int leftOut = 0;

    foreach (EbTransaction transaction in transactions) {
      if (KeptAs(transaction) is { } status)
        kept.Add(Mapped(transaction, status));
      else
        leftOut++;
    }

    return new MappedTransactions(kept, leftOut);
  }

  /// <summary>
  /// The status a kept transaction carries; <see langword="null"/> for one left out. A status outside the API reference's
  /// seven (missing, empty or unknown) means the bank changed its answer, and leaving it out would hide it (D3, D4).
  /// </summary>
  private static TransactionStatus? KeptAs(EbTransaction transaction) {
    ArgumentNullException.ThrowIfNull(transaction);

    return transaction.Status switch {
      BOOKED => TransactionStatus.Booked,
      PENDING => TransactionStatus.Pending,
      CANCELLED or REJECTED or ON_HOLD or SCHEDULED or OTHER => null,
      _ => throw new BankReadException("A transaction has a status the bank's API reference does not define."),
    };
  }

  /// <summary>
  /// The other fields of D3's table: the reference; the transaction date, else the booking date, else the value date; the
  /// amount, negative for money spent and positive for money received, zero without a sign; its currency; the
  /// counterparty, the creditor for money spent and the debtor for money received (none when that side has no name); the
  /// payment details unchanged; the type code unchanged, none when the bank gives no code (c010 design.md D4).
  /// </summary>
  private static BankTransaction Mapped(EbTransaction transaction, TransactionStatus status) {
    DateOnly date = transaction.TransactionDate ?? transaction.BookingDate ?? transaction.ValueDate
      ?? throw new BankReadException("A transaction has no date: neither a transaction, a booking nor a value date.");

    // The amount, its currency and a line of details may be missing at the bank, whatever their annotations:
    // System.Text.Json does not enforce them.
    if (transaction.TransactionAmount is not { } transactionAmount || !WireAmount.TryParse(transactionAmount.Amount, out decimal amount))
      throw new BankReadException("A transaction has no amount, or one that is not a decimal number.");

    // A minus would mean the bank changed its answer, with a meaning nobody knows (c006 design.md D2). A leading plus is
    // accepted; a "-0" is zero.
    if (amount < 0m)
      throw new BankReadException("A booked or pending transaction has a negative amount; the bank's transaction amounts carry no sign.");

    if (transactionAmount.Currency is null)
      throw new BankReadException("A transaction has no currency.");

    IReadOnlyList<string> paymentDetails = transaction.RemittanceInformation ?? [];

    if (paymentDetails.Any(static line => line is null))
      throw new BankReadException("A transaction has a line of payment details that is null.");

    // A decimal zero keeps a sign bit, and -0 equals 0: a bank's "-0" or a negated zero would come out as a negative zero.
    decimal size = decimal.Abs(amount);

    (decimal signedAmount, EbParty? counterparty) = transaction.CreditDebitIndicator switch {
      MONEY_SPENT => (size == 0m ? size : -size, transaction.Creditor),
      MONEY_RECEIVED => (size, transaction.Debtor),
      _ => throw new BankReadException("A transaction has a credit/debit indicator the mapping does not read."),
    };

    return new BankTransaction(
      transaction.EntryReference,
      status,
      date,
      signedAmount,
      transactionAmount.Currency,
      counterparty?.Name,
      paymentDetails,
      transaction.BankTransactionCode?.Code);
  }
}

/// <summary>The transactions a read returns, and how many the bank listed with another status (only counted, D3).</summary>
public sealed record MappedTransactions(IReadOnlyList<BankTransaction> Kept, int LeftOut);