using System.Globalization;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// What a transaction carries (spec bank-reads, c004 design.md D3): the reference, the status, one date (the transaction
/// date, else the booking date, else the value date), the amount signed by direction in its currency, the counterparty
/// and the payment details, unchanged. Each test maps one transaction the bank lists, made up in the Mock ASPSP
/// capture's shape: a booked payment, money spent (<c>DBIT</c>), or a booked transfer received (<c>CRDT</c>), dated like
/// Revolut's settled ones (booking and value date, no transaction date), or a pending payment (a transaction date only).
/// </summary>
public sealed class TransactionMappingTests {
  private static readonly DateOnly _november2 = new(2026, 11, 2);
  private static readonly DateOnly _november3 = new(2026, 11, 3);
  private static readonly DateOnly _november4 = new(2026, 11, 4);
  private static readonly DateOnly _november5 = new(2026, 11, 5);

  // Money spent

  [Test]
  public void A_booked_transaction_is_marked_booked_and_keeps_its_reference() {
    BankTransaction mapped = MapOne(BookedPayment() with { EntryReference = "e-101" });

    mapped.Status.ShouldBe(TransactionStatus.Booked);
    mapped.Reference.ShouldBe("e-101");
  }

  [Test]
  public void Money_spent_has_a_negative_amount_in_its_currency() {
    BankTransaction mapped = MapOne(BookedPayment() with { TransactionAmount = new("CZK", "305.40") });

    mapped.Amount.ShouldBe(-305.40m);
    mapped.Currency.ShouldBe("CZK");
  }

  [Test]
  public void Money_spent_names_the_creditor_as_the_counterparty() {
    BankTransaction mapped = MapOne(BookedPayment() with { Creditor = new("Pekárna U Lípy"), Debtor = new("Jana Nováková") });

    mapped.Counterparty.ShouldBe("Pekárna U Lípy");
  }

  /// <summary>Unchanged means as the bank sent them: in order, with their spaces, a line repeating the payee kept (D3: hiding it is C7's display rule).</summary>
  [Test]
  public void The_payment_details_are_the_banks_lines_unchanged_and_in_order() {
    BankTransaction mapped = MapOne(BookedPayment() with { RemittanceInformation = ["Pekárna U Lípy", "  Praha 2  ", "Pekárna U Lípy"] });

    mapped.PaymentDetails.ShouldBe(["Pekárna U Lípy", "  Praha 2  ", "Pekárna U Lípy"]);
  }

  /// <param name="details">The capture lists such a transaction with an empty list; the API reference also allows none at all.</param>
  [Test]
  [Arguments("an empty list")]
  [Arguments("no list at all")]
  public void A_transaction_without_payment_details_has_none(string details) {
    IReadOnlyList<string>? remittanceInformation = details switch {
      "an empty list" => [],
      "no list at all" => null,
      _ => throw new ArgumentOutOfRangeException(nameof(details), details, "Not a known case."),
    };

    BankTransaction mapped = MapOne(BookedPayment() with { RemittanceInformation = remittanceInformation });

    mapped.PaymentDetails.ShouldBeEmpty();
  }

  // Money received

  [Test]
  public void Money_received_has_a_positive_amount() {
    BankTransaction mapped = MapOne(BookedTransferReceived() with { TransactionAmount = new("EUR", "50.00") });

    mapped.Amount.ShouldBe(50.00m);
  }

  [Test]
  public void Money_received_names_the_debtor_as_the_counterparty() {
    BankTransaction mapped = MapOne(BookedTransferReceived() with { Debtor = new("Jan Novák"), Creditor = new("Jana Nováková") });

    mapped.Counterparty.ShouldBe("Jan Novák");
  }

  /// <param name="party">
  /// Which side has no name. The other side's party keeps its name each time (the account holder, made up), so a mapping
  /// that falls back to it fails. Real data (D3): 1 of 103 payments had no creditor's name, 2 of 13 receipts no debtor's.
  /// </param>
  [Test]
  [Arguments("money spent, no creditor")]
  [Arguments("money spent, a creditor without a name")]
  [Arguments("money received, no debtor")]
  [Arguments("money received, a debtor without a name")]
  public void A_transaction_without_a_named_counterparty_has_none(string party) {
    EbParty accountHolder = new("Jana Nováková");

    EbTransaction transaction = party switch {
      "money spent, no creditor" => BookedPayment() with { Creditor = null, Debtor = accountHolder },
      "money spent, a creditor without a name" => BookedPayment() with { Creditor = new(Name: null), Debtor = accountHolder },
      "money received, no debtor" => BookedTransferReceived() with { Debtor = null, Creditor = accountHolder },
      "money received, a debtor without a name" => BookedTransferReceived() with { Debtor = new(Name: null), Creditor = accountHolder },
      _ => throw new ArgumentOutOfRangeException(nameof(party), party, "Not a known case."),
    };

    MapOne(transaction).Counterparty.ShouldBeNull();
  }

  // Pending

  /// <summary>Marked pending, and mapped like any other: dated by its transaction date, the only date a pending one has.</summary>
  [Test]
  public void A_pending_transaction_is_marked_pending() {
    BankTransaction mapped = MapOne(PendingPayment());

    mapped.Status.ShouldBe(TransactionStatus.Pending);
    mapped.Reference.ShouldBe("e-103");
    mapped.Date.ShouldBe(_november5);
    mapped.Amount.ShouldBe(-8.90m);
    mapped.Currency.ShouldBe("EUR");
    mapped.Counterparty.ShouldBe("Kavárna Na Rohu");
    mapped.PaymentDetails.ShouldBe(["Kavárna Na Rohu"]);
  }

  [Test]
  public void A_pending_transaction_without_a_reference_has_none() {
    BankTransaction mapped = MapOne(PendingPayment() with { EntryReference = null });

    mapped.Reference.ShouldBeNull();
  }

  // Other statuses: left out, only counted (D3; spec bank-reads, "Reading transactions from a given day")

  /// <param name="status">
  /// One of the API reference's statuses other than booked and pending: cancelled, rejected, on hold, scheduled, other.
  /// It sits between kept transactions, so keeping everything, dropping everything or reordering all fail.
  /// </param>
  [Test]
  [Arguments("CNCL")]
  [Arguments("RJCT")]
  [Arguments("HOLD")]
  [Arguments("SCHD")]
  [Arguments("OTHR")]
  public void Cancelled_rejected_on_hold_scheduled_and_other_transactions_are_left_out(string status) {
    MappedTransactions mapped = TransactionMapping.Map([
      BookedPayment() with { EntryReference = "e-101" },
      BookedPayment() with { Status = status, EntryReference = "e-201" },
      PendingPayment() with { EntryReference = "e-103" },
      BookedTransferReceived() with { EntryReference = "e-102" },
    ]);

    mapped.Kept.Select(static transaction => transaction.Reference).ShouldBe(["e-101", "e-103", "e-102"]);
  }

  /// <param name="list">None left out; or each other status once and cancelled twice, between kept transactions.</param>
  /// <param name="leftOut">How many the list holds with a status other than booked or pending.</param>
  [Test]
  [Arguments("booked and pending only", 0)]
  [Arguments("every other status, one of them twice", 6)]
  public void The_transactions_left_out_are_counted(string list, int leftOut) {
    EbTransaction[] transactions = list switch {
      "booked and pending only" => [BookedPayment(), PendingPayment(), BookedTransferReceived()],
      "every other status, one of them twice" => [
        BookedPayment(),
        BookedPayment() with { Status = "CNCL" },
        BookedPayment() with { Status = "RJCT" },
        PendingPayment(),
        BookedPayment() with { Status = "HOLD" },
        BookedPayment() with { Status = "SCHD" },
        BookedPayment() with { Status = "OTHR" },
        BookedPayment() with { Status = "CNCL" },
        BookedTransferReceived(),
      ],
      _ => throw new ArgumentOutOfRangeException(nameof(list), list, "Not a known case."),
    };

    TransactionMapping.Map(transactions).LeftOut.ShouldBe(leftOut);
  }

  /// <param name="status">
  /// Outside the API reference's closed set (BOOK, PDNG, CNCL, RJCT, HOLD, SCHD, OTHR): missing, empty or unknown. The
  /// bank changed its answer (D4 "everything else"); leaving such a transaction out would hide it silently.
  /// </param>
  [Test]
  [Arguments("missing")]
  [Arguments("empty")]
  [Arguments("unknown")]
  public void A_transaction_with_a_status_the_bank_does_not_define_is_an_error(string status) {
    string? bankStatus = status switch {
      "missing" => null,
      "empty" => "",
      "unknown" => "XXXX",
      _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Not a known case."),
    };

    // A missing status reaches the record as null, whatever its annotation: System.Text.Json does not enforce it.
    EbTransaction transaction = BookedPayment() with { Status = bankStatus! };

    BankReadException error = Should.Throw<BankReadException>(() => TransactionMapping.Map([transaction]));

    ShouldCarryNoBankData(error, transaction, bankStatus);
  }

  // The date

  [Test]
  public void A_transaction_is_dated_by_its_transaction_date_when_the_bank_gives_one() {
    BankTransaction mapped = MapOne(BookedPayment() with { TransactionDate = _november2, BookingDate = _november3, ValueDate = _november4 });

    mapped.Date.ShouldBe(_november2);
  }

  [Test]
  public void Without_a_transaction_date_the_booking_date_dates_it() {
    BankTransaction mapped = MapOne(BookedPayment() with { TransactionDate = null, BookingDate = _november3, ValueDate = _november4 });

    mapped.Date.ShouldBe(_november3);
  }

  [Test]
  public void Without_a_transaction_or_booking_date_the_value_date_dates_it() {
    BankTransaction mapped = MapOne(BookedPayment() with { TransactionDate = null, BookingDate = null, ValueDate = _november4 });

    mapped.Date.ShouldBe(_november4);
  }

  // The amount on any machine

  /// <param name="culture">
  /// Czech writes 1234,56 (the owner's machine); German writes 1.234,56, so a culture-bound parse could even misread the
  /// bank's point as a thousands separator.
  /// </param>
  [Test]
  [Arguments("cs-CZ")]
  [Arguments("de-DE")]
  public void The_amount_is_read_the_same_whatever_the_machines_culture(string culture) {
    CultureInfo original = CultureInfo.CurrentCulture;

    try {
      CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);

      BankTransaction mapped = MapOne(BookedPayment() with { TransactionAmount = new("EUR", "1234.56") });

      mapped.Amount.ShouldBe(-1234.56m);
    }
    finally {
      CultureInfo.CurrentCulture = original;
    }
  }

  // Transactions that cannot be read: a bug or a changed answer, never a result (D4), and never quoting the bank (D5)

  [Test]
  [Arguments("12x34.56")]
  [Arguments("")]
  public void A_transaction_whose_amount_is_not_a_number_is_an_error_and_the_message_does_not_contain_it(string amount) {
    EbTransaction transaction = BookedPayment() with { TransactionAmount = new("EUR", amount) };

    BankReadException error = Should.Throw<BankReadException>(() => TransactionMapping.Map([transaction]));

    ShouldCarryNoBankData(error, transaction);
  }

  [Test]
  public void A_transaction_without_any_date_is_an_error() {
    EbTransaction transaction = BookedPayment() with { TransactionDate = null, BookingDate = null, ValueDate = null };

    BankReadException error = Should.Throw<BankReadException>(() => TransactionMapping.Map([transaction]));

    ShouldCarryNoBankData(error, transaction);
  }

  /// <param name="indicator">The bank's <c>credit_debit_indicator</c>: missing, empty, or a value that is neither DBIT nor CRDT.</param>
  [Test]
  [Arguments("missing")]
  [Arguments("empty")]
  [Arguments("unknown")]
  public void A_transaction_that_is_neither_money_spent_nor_money_received_is_an_error(string indicator) {
    string? creditDebitIndicator = indicator switch {
      "missing" => null,
      "empty" => "",
      "unknown" => "XXXX",
      _ => throw new ArgumentOutOfRangeException(nameof(indicator), indicator, "Not a known case."),
    };

    // A missing indicator reaches the record as null, whatever its annotation: System.Text.Json does not enforce it.
    EbTransaction transaction = BookedPayment() with { CreditDebitIndicator = creditDebitIndicator! };

    BankReadException error = Should.Throw<BankReadException>(() => TransactionMapping.Map([transaction]));

    ShouldCarryNoBankData(error, transaction, creditDebitIndicator);
  }

  /// <summary>A booked payment of 12.30 EUR to "Pekárna U Lípy", booked and valued on 3 November; each test changes what it is about.</summary>
  private static EbTransaction BookedPayment() => new(
    EntryReference: "e-101",
    Status: "BOOK",
    TransactionAmount: new("EUR", "12.30"),
    CreditDebitIndicator: "DBIT",
    Creditor: new("Pekárna U Lípy"),
    Debtor: null,
    TransactionDate: null,
    BookingDate: _november3,
    ValueDate: _november3,
    RemittanceInformation: ["Pekárna U Lípy"]);

  /// <summary>A booked transfer of 50.00 EUR received from "Jan Novák" on 4 November, as the capture lists one; each test changes what it is about.</summary>
  private static EbTransaction BookedTransferReceived() => new(
    EntryReference: "e-102",
    Status: "BOOK",
    TransactionAmount: new("EUR", "50.00"),
    CreditDebitIndicator: "CRDT",
    Creditor: null,
    Debtor: new("Jan Novák"),
    TransactionDate: null,
    BookingDate: _november4,
    ValueDate: _november4,
    RemittanceInformation: ["Kapesné listopad"]);

  /// <summary>
  /// A pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 5 November, as the capture lists one: a transaction date
  /// only, no booking or value date yet; each test changes what it is about.
  /// </summary>
  private static EbTransaction PendingPayment() => new(
    EntryReference: "e-103",
    Status: "PDNG",
    TransactionAmount: new("EUR", "8.90"),
    CreditDebitIndicator: "DBIT",
    Creditor: new("Kavárna Na Rohu"),
    Debtor: null,
    TransactionDate: _november5,
    BookingDate: null,
    ValueDate: null,
    RemittanceInformation: ["Kavárna Na Rohu"]);

  /// <summary>The one transaction the mapping keeps from a list of one.</summary>
  private static BankTransaction MapOne(EbTransaction transaction) => TransactionMapping.Map([transaction]).Kept.ShouldHaveSingleItem();

  /// <summary>
  /// The error as it would be logged (message, inner exceptions, stack trace, as in BalanceSelectionTests) holds none of
  /// the transaction's bank data: amount, currency, reference, counterparties, details, and whatever else the test names.
  /// </summary>
  private static void ShouldCarryNoBankData(BankReadException error, EbTransaction transaction, params string?[] more) {
    string[] bankData = [
      .. new[] { transaction.TransactionAmount.Amount, transaction.TransactionAmount.Currency, transaction.EntryReference, transaction.Creditor?.Name, transaction.Debtor?.Name }
        .Concat(transaction.RemittanceInformation ?? [])
        .Concat(more)
        .OfType<string>()
        .Where(static value => value.Length > 0),
    ];

    string text = error.ToString();

    bankData.ShouldAllBe(value => !text.Contains(value, StringComparison.Ordinal), "the error carries no bank data from the transaction");
  }
}