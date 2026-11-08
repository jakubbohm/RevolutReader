using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// Reads the balance as the present user (c009 design.md D1). The read time is the TimeProvider's when the bank answered;
/// the rate is <see cref="KorunaRate.CzkPerEur"/> (C13). A bank failure comes back as the same case. A balance in any
/// currency other than EUR throws <see cref="InvalidOperationException"/>, whose message names neither the amount nor the
/// currency.
/// </summary>
public sealed class ReadBalanceHandler(IBankAccount bank, TimeProvider time) {
  /// <summary>The account's currency (ISO 4217), as the bank names it.</summary>
  private const string EURO = "EUR";

  /// <exception cref="InvalidOperationException">The bank answered a balance in another currency than euros: a bug.</exception>
  public async Task<BankResult<AccountBalance>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    return await bank.ReadBalance(user, cancellationToken) switch {
      Balance balance => InEuros(balance, readAt: time.GetUtcNow()),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };
  }

  /// <summary>
  /// The balance with its read time and the koruna rate. The account is a euro account, so another currency is a bug
  /// (D1): the message names neither the amount nor the currency, as no error message names bank data
  /// (docs/conventions/README.md § Backend code).
  /// </summary>
  private static AccountBalance InEuros(Balance balance, DateTimeOffset readAt) {
    if (!string.Equals(balance.Currency, EURO, StringComparison.Ordinal))
      throw new InvalidOperationException("The bank answered the balance in a currency other than euros, though the account is a euro account.");

    return new AccountBalance(balance.Amount, readAt, KorunaRate.CzkPerEur);
  }
}