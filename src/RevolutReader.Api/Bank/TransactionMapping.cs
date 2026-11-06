namespace RevolutReader.Api.Bank;

/// <summary>
/// From the bank's transactions to the port's (c004 design.md D3). A transaction it cannot read is a
/// <see cref="BankReadException"/> (D4 "everything else"), whose text names what is wrong and quotes nothing from the
/// bank (D5).
/// </summary>
public static class TransactionMapping {
  /// <summary>The bank's status of a booked transaction.</summary>
  private const string BOOKED = "BOOK";

  /// <summary>The bank's credit/debit indicator of money spent.</summary>
  private const string MONEY_SPENT = "DBIT";

  /// <summary>Booked and pending kept and mapped (D3); every other status left out and counted.</summary>
  public static MappedTransactions Map(IEnumerable<EbTransaction> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    return new MappedTransactions([.. transactions.Select(Mapped)], LeftOut: 0);
  }

  /// <summary>
  /// The fields of D3's table: the reference; the status; the transaction date, else the booking date, else the value
  /// date; the amount, negative for money spent; its currency; the creditor for money spent; the payment details unchanged.
  /// </summary>
  private static BankTransaction Mapped(EbTransaction transaction) {
    ArgumentNullException.ThrowIfNull(transaction);

    TransactionStatus status = transaction.Status switch {
      BOOKED => TransactionStatus.Booked,
      _ => throw new BankReadException("A transaction has a status the mapping does not read."),
    };

    DateOnly date = transaction.TransactionDate ?? transaction.BookingDate ?? transaction.ValueDate
      ?? throw new BankReadException("A transaction has no date: neither a transaction, a booking nor a value date.");

    if (!WireAmount.TryParse(transaction.TransactionAmount.Amount, out decimal amount))
      throw new BankReadException("A transaction has an amount that is not a decimal number.");

    (decimal signedAmount, EbParty? counterparty) = transaction.CreditDebitIndicator switch {
      MONEY_SPENT => (-amount, transaction.Creditor),
      _ => throw new BankReadException("A transaction has a credit/debit indicator the mapping does not read."),
    };

    return new BankTransaction(
      transaction.EntryReference,
      status,
      date,
      signedAmount,
      transaction.TransactionAmount.Currency,
      counterparty?.Name,
      transaction.RemittanceInformation ?? []);
  }
}

/// <summary>The transactions a read returns, and how many the bank listed with another status (only counted, D3).</summary>
public sealed record MappedTransactions(IReadOnlyList<BankTransaction> Kept, int LeftOut);