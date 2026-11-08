using System.ComponentModel;

namespace RevolutReader.Api.Account;

/// <summary>
/// A page of transactions as the API answers it (spec account-transactions, c010 design.md D10): exactly the transactions
/// the screen shows, what it says of older ones, and the koruna rate with its date; nothing else of the bank's answer. The
/// descriptions are the API description's, in plain words.
/// </summary>
[Description("A page of the account's transactions, whether older ones are kept, and the koruna rate with its date")]
public sealed record TransactionPageResponse(
  [property: Description("The page's transactions, newest day first, in the bank's order within a day")] IReadOnlyList<TransactionResponse> Transactions,
  [property: Description("The day before which older transactions are kept, to ask for the next older page with; null when none are")] DateOnly? OlderBefore,
  [property: Description("Czech koruna per euro, the rate the app converts euro amounts with")] decimal CzkPerEur,
  [property: Description("The day the koruna rate is for")] DateOnly RateDate) {
  /// <summary>A page as the API answers it, the newest or an older one: each transaction's seven fields, as the page holds them.</summary>
  internal static TransactionPageResponse Of(TransactionPage page) {
    ArgumentNullException.ThrowIfNull(page);

    return new(
      [.. page.Transactions.Select(static transaction => new TransactionResponse(
        transaction.Date, transaction.Amount, transaction.Currency, transaction.Pending, transaction.Counterparty, transaction.Details, transaction.Kind))],
      page.OlderBefore,
      page.CzkPerEur,
      page.RateDate);
  }
}

/// <summary>A transaction as the API answers it (D10): the seven fields the screen shows.</summary>
[Description("A transaction as the app shows it")]
public sealed record TransactionResponse(
  [property: Description("The day the transaction is dated by")] DateOnly Date,
  [property: Description("Negative for money spent, positive for money received")] decimal Amount,
  [property: Description("The amount's currency, an ISO 4217 code")] string Currency,
  [property: Description("Whether the bank has not settled the transaction yet")] bool Pending,
  [property: Description("The payee of money spent, the payer of money received; null when the bank names none")] string? Counterparty,
  [property: Description("The bank's text, line by line, as the app shows it")] IReadOnlyList<string> Details,
  [property: Description("The kind of transaction, from the bank's type code")] TransactionKind Kind);