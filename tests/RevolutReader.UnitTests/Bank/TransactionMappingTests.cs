using System.Globalization;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// What a transaction carries (spec bank-reads, c004 design.md D3): the reference, the status, one date (the transaction
/// date, else the booking date, else the value date), the amount signed by direction in its currency, the counterparty
/// and the payment details, unchanged. Each test maps one transaction the bank lists, made up in the Mock ASPSP
/// capture's shape: a booked payment, money spent (<c>DBIT</c>), dated like Revolut's settled ones (booking and value
/// date, no transaction date).
/// </summary>
public sealed class TransactionMappingTests {
  private static readonly DateOnly _november2 = new(2026, 11, 2);
  private static readonly DateOnly _november3 = new(2026, 11, 3);
  private static readonly DateOnly _november4 = new(2026, 11, 4);

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

  /// <summary>The one transaction the mapping keeps from a list of one.</summary>
  private static BankTransaction MapOne(EbTransaction transaction) => TransactionMapping.Map([transaction]).Kept.ShouldHaveSingleItem();
}