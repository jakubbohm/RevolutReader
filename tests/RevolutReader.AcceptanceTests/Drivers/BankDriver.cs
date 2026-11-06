using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Bank;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Drives the app's bank port (spec bank-reads, c004 design.md D1): takes <see cref="IBankAccount"/> from the test's own
/// app copy, so the reads run on the production wiring (settings, <c>HttpClient</c>, no retries) against
/// <see cref="FakeBank"/>. Turns the DSL's facts into the fake bank's answers, and the port's results into DSL answers.
/// <list type="bullet">
/// <item>A <see cref="BankResult{T}"/> becomes the answer's outcome: the value is <see cref="BankOutcome.Read"/>, each
/// failure its own outcome, with no value.</item>
/// <item>A <see cref="BankTransaction"/> becomes a <see cref="TransactionSeen"/> field by field; booked is
/// <see cref="TransactionSeen.STATUS_BOOKED"/>, pending <see cref="TransactionSeen.STATUS_PENDING"/>.</item>
/// <item>A received request's user headers are <c>Psu-Ip-Address</c> and <c>Psu-User-Agent</c>; a request carrying no
/// <c>Psu-*</c> header at all has none (<see cref="RequestAtBank.WithoutUserHeaders"/>).</item>
/// </list>
/// Filled in by the wiring groups; until then every method throws.
/// </summary>
public sealed class BankDriver(FakeBank bank, IServiceProvider services) {
  /// <summary>As the API reference writes a calendar date.</summary>
  private const string DATE = "yyyy-MM-dd";

  /// <summary>
  /// The one page <see cref="Lists"/> gave. The fake bank gets it when the read's day is known (in
  /// <see cref="ReadTransactionsFrom"/>), so it answers only a request whose <c>date_from</c> is that day.
  /// </summary>
  private string? _listedPage;

  /// <summary>The fake bank this test's app copy reads.</summary>
  private FakeBank Bank => bank;

  /// <summary>The port, as the app copy wires it.</summary>
  private IBankAccount Account => services.GetRequiredService<IBankAccount>();

  /// <summary>
  /// The balances answer of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-balances.json</c>
  /// (made-up data), copied with its shape and its other fields as captured; only the ITAV amount and currency are the
  /// DSL's. The amount goes on the wire as a string, as the bank writes it.
  /// </summary>
  public void HasAvailableBalance(decimal amount, string currency) =>
    Bank.AnswerBalances($$"""
      {
        "balances": [
          {
            "name": "Available balance calculated in the course of the business day",
            "balance_amount": {
              "currency": {{JsonString(currency)}},
              "amount": {{JsonString(amount.ToString(CultureInfo.InvariantCulture))}}
            },
            "balance_type": "ITAV",
            "last_change_date_time": null,
            "reference_date": "2026-11-06",
            "last_committed_transaction": null
          }
        ]
      }
      """);

  /// <summary>One page, the transactions in the given order, and no next page (<c>continuation_key: null</c>, as the capture ends).</summary>
  public void Lists(IReadOnlyList<TransactionAtBank> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    _listedPage = $$"""
      {
        "transactions": [{{string.Join(",", transactions.Select(TransactionJson))}}],
        "continuation_key": null
      }
      """;
  }

  public void ListsInPages(DateOnly since, int count, int pages) => throw new NotImplementedException();

  public void ListsFirstPageThenFails(DateOnly since) => throw new NotImplementedException();

  public void ReportsExpiredSession() => throw new NotImplementedException();

  public void ReportsRequestLimitReached() => throw new NotImplementedException();

  public void ReportsOwnError() => throw new NotImplementedException();

  public void AnswersAfterTheRequestTimeout() => throw new NotImplementedException();

  public async Task<BalanceAnswer> ReadBalanceFor(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return AnswerOf(await Account.ReadBalance(Present(user), CancellationToken.None));
  }

  public Task<BalanceAnswer> ReadBalanceUnattended() => throw new NotImplementedException();

  public async Task<TransactionsAnswer> ReadTransactionsFrom(DateOnly day, UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    if (_listedPage is not null)
      Bank.AnswerTransactionsPage(day, continuationKey: null, _listedPage);

    return AnswerOf(await Account.ReadTransactions(day, Present(user), CancellationToken.None));
  }

  public IReadOnlyList<RequestAtBank> RequestsReceived() => throw new NotImplementedException();

  /// <summary>The value is <see cref="BankOutcome.Read"/> with the balance; each failure is its own outcome, with no balance.</summary>
  private static BalanceAnswer AnswerOf(BankResult<Balance> result) => result switch {
    Balance balance => BalanceAnswer.Of(balance.Amount, balance.Currency),
    BankAccessExpired => BalanceAnswer.AccessExpired,
    BankRateLimited => BalanceAnswer.RateLimited,
    BankUnavailable => BalanceAnswer.BankUnavailable,
  };

  /// <summary>The value is <see cref="BankOutcome.Read"/> with the transactions in the order returned; each failure is its own outcome, with none.</summary>
  private static TransactionsAnswer AnswerOf(BankResult<Transactions> result) => result switch {
    Transactions transactions => TransactionsAnswer.Of(transactions.Items.Select(Seen)),
    BankAccessExpired => TransactionsAnswer.AccessExpired,
    BankRateLimited => TransactionsAnswer.RateLimited,
    BankUnavailable => TransactionsAnswer.BankUnavailable,
  };

  /// <summary>Field by field; the details become <see cref="Lines"/>.</summary>
  private static TransactionSeen Seen(BankTransaction transaction) => new(
    transaction.Reference,
    transaction.Status switch {
      TransactionStatus.Booked => TransactionSeen.STATUS_BOOKED,
      TransactionStatus.Pending => TransactionSeen.STATUS_PENDING,
      _ => throw new ArgumentOutOfRangeException(nameof(transaction), transaction.Status, "Not a status a read returns."),
    },
    transaction.Date,
    transaction.Amount,
    transaction.Currency,
    transaction.Counterparty,
    new Lines(transaction.PaymentDetails));

  private static PresentUser Present(UserAtDevice user) => new(IPAddress.Parse(user.IpAddress), user.Browser);

  /// <summary>
  /// One transaction in the shape of the Mock ASPSP capture <c>spikes/enable-banking-mock/evidence/2026-11-06-account1-transactions.json</c>
  /// (made-up data), copied from its booked payment <c>c004-b04</c>. Every field the DSL gives is set from it; every field
  /// it does not give is absent, as the capture writes absence (<c>null</c>, or no lines of details), and nothing of the
  /// template's own data is kept. Money out names the counterparty as the creditor, money in as the debtor; a booked
  /// transaction carries its day as booking and value date, any other as its transaction date.
  /// </summary>
  private static string TransactionJson(TransactionAtBank transaction) {
    bool booked = transaction.Status == StatusAtBank.Booked;
    string day = transaction.Day.ToString(DATE, CultureInfo.InvariantCulture);

    return $$"""
      {
        "entry_reference": {{JsonString(transaction.Reference)}},
        "merchant_category_code": null,
        "transaction_amount": {
          "currency": {{JsonString(transaction.Currency)}},
          "amount": {{JsonString(transaction.Amount.ToString(CultureInfo.InvariantCulture))}}
        },
        "creditor": {{Party(transaction.Flow == MoneyFlow.Out ? transaction.Counterparty : null)}},
        "creditor_account": null,
        "creditor_agent": null,
        "debtor": {{Party(transaction.Flow == MoneyFlow.In ? transaction.Counterparty : null)}},
        "debtor_account": null,
        "debtor_agent": null,
        "bank_transaction_code": null,
        "credit_debit_indicator": {{JsonString(BankIndicator(transaction.Flow))}},
        "status": {{JsonString(BankStatus(transaction.Status))}},
        "booking_date": {{JsonString(booked ? day : null)}},
        "value_date": {{JsonString(booked ? day : null)}},
        "transaction_date": {{JsonString(booked ? null : day)}},
        "balance_after_transaction": null,
        "reference_number": null,
        "reference_number_schema": null,
        "remittance_information": {{JsonSerializer.Serialize(transaction.Details.Items)}},
        "debtor_account_additional_identification": null,
        "creditor_account_additional_identification": null,
        "exchange_rate": null,
        "note": null,
        "transaction_id": null
      }
      """;
  }

  /// <summary>A creditor or debtor as the capture writes one: the name and nothing else; <c>null</c> when there is none.</summary>
  private static string Party(string? name) => name is null ? "null" : $$"""
    {
      "name": {{JsonString(name)}},
      "postal_address": null,
      "organisation_id": null,
      "private_id": null,
      "contact_details": null
    }
    """;

  private static string BankStatus(StatusAtBank status) => status switch {
    StatusAtBank.Booked => "BOOK",
    StatusAtBank.Pending => "PDNG",
    StatusAtBank.Cancelled => "CNCL",
    StatusAtBank.Rejected => "RJCT",
    _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Not a status at the bank."),
  };

  private static string BankIndicator(MoneyFlow flow) => flow switch {
    MoneyFlow.Out => "DBIT",
    MoneyFlow.In => "CRDT",
    _ => throw new ArgumentOutOfRangeException(nameof(flow), flow, "Not a money flow."),
  };

  /// <summary><paramref name="value"/> as a JSON string literal, quotes and escapes included; <c>null</c> when there is none.</summary>
  private static string JsonString(string? value) => JsonSerializer.Serialize(value);
}