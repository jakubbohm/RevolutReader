using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A success answer the client cannot read (c004 design.md D4 "a body that cannot be parsed", § Error model): not JSON,
/// JSON of another shape, or without what the read needs. Each is a <see cref="BankReadException"/>, never a serializer's
/// or the runtime's own exception, and its text quotes nothing from the answer (D5). The values are made up, each holding
/// a marker that must not turn up in the error.
/// </summary>
public sealed class UnreadableAnswerTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "7f3a9c";

  private static readonly DateOnly _november1 = new(2026, 11, 1);

  /// <param name="body">
  /// Not JSON; JSON of another shape; no list of balances, a null list, or a gap in it; the available balance without an
  /// amount, or with an amount but no currency, or a null one; a JSON null.
  /// </param>
  [Test]
  [Arguments($"<html><body>maintenance {MARKER}</body></html>")]
  [Arguments($$"""{ "balances": "{{MARKER}}" }""")]
  [Arguments($$"""{ "note": "{{MARKER}}" }""")]
  [Arguments($$"""{ "balances": null, "note": "{{MARKER}}" }""")]
  [Arguments($$"""{ "balances": [null], "note": "{{MARKER}}" }""")]
  [Arguments($$"""{ "balances": [{ "name": "{{MARKER}}", "balance_type": "ITAV" }] }""")]
  [Arguments($$"""{ "balances": [{ "name": "{{MARKER}}", "balance_amount": { "amount": "1234.56" }, "balance_type": "ITAV" }] }""")]
  [Arguments($$"""{ "balances": [{ "name": "{{MARKER}}", "balance_amount": { "currency": null, "amount": "1234.56" }, "balance_type": "ITAV" }] }""")]
  [Arguments("null")]
  public async Task A_balances_answer_that_cannot_be_read_is_an_error_that_does_not_quote_it(string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, body);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.ToString().ShouldNotContain(MARKER);
  }

  /// <param name="body">
  /// Not JSON; JSON of another shape; no list of transactions, a null list, or a gap in it; a booked transaction without
  /// its amount, with an amount but no currency or a null one, or with a null line among its payment details (in the Mock
  /// ASPSP capture's shape, its other fields made up). Each is the last page (<c>continuation_key: null</c>), so no other
  /// rule, such as a repeated key, can end the read instead.
  /// </param>
  [Test]
  [Arguments($"<html><body>maintenance {MARKER}</body></html>")]
  [Arguments($$"""{ "transactions": "{{MARKER}}", "continuation_key": null }""")]
  [Arguments($$"""{ "continuation_key": null, "note": "{{MARKER}}" }""")]
  [Arguments($$"""{ "transactions": null, "continuation_key": null, "note": "{{MARKER}}" }""")]
  [Arguments($$"""{ "transactions": [null], "continuation_key": null, "note": "{{MARKER}}" }""")]
  [Arguments($$"""
    {
      "transactions": [
        {
          "entry_reference": "e-{{MARKER}}",
          "creditor": { "name": "Pekárna {{MARKER}}" },
          "credit_debit_indicator": "DBIT",
          "status": "BOOK",
          "booking_date": "2026-11-03",
          "value_date": "2026-11-03",
          "transaction_date": null,
          "remittance_information": ["Pekárna {{MARKER}}"]
        }
      ],
      "continuation_key": null
    }
    """)]
  [Arguments($$"""
    {
      "transactions": [
        {
          "entry_reference": "e-{{MARKER}}",
          "transaction_amount": { "amount": "12.30" },
          "creditor": { "name": "Pekárna {{MARKER}}" },
          "credit_debit_indicator": "DBIT",
          "status": "BOOK",
          "booking_date": "2026-11-03",
          "value_date": "2026-11-03",
          "transaction_date": null,
          "remittance_information": ["Pekárna {{MARKER}}"]
        }
      ],
      "continuation_key": null
    }
    """)]
  [Arguments($$"""
    {
      "transactions": [
        {
          "entry_reference": "e-{{MARKER}}",
          "transaction_amount": { "currency": null, "amount": "12.30" },
          "creditor": { "name": "Pekárna {{MARKER}}" },
          "credit_debit_indicator": "DBIT",
          "status": "BOOK",
          "booking_date": "2026-11-03",
          "value_date": "2026-11-03",
          "transaction_date": null,
          "remittance_information": ["Pekárna {{MARKER}}"]
        }
      ],
      "continuation_key": null
    }
    """)]
  [Arguments($$"""
    {
      "transactions": [
        {
          "entry_reference": "e-{{MARKER}}",
          "transaction_amount": { "currency": "EUR", "amount": "12.30" },
          "creditor": { "name": "Pekárna {{MARKER}}" },
          "credit_debit_indicator": "DBIT",
          "status": "BOOK",
          "booking_date": "2026-11-03",
          "value_date": "2026-11-03",
          "transaction_date": null,
          "remittance_information": ["Pekárna {{MARKER}}", null]
        }
      ],
      "continuation_key": null
    }
    """)]
  public async Task A_transactions_page_that_cannot_be_read_is_an_error_that_does_not_quote_it(string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, body);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None));

    error.ToString().ShouldNotContain(MARKER);
  }
}