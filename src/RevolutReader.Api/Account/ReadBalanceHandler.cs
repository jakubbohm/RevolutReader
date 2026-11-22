using RevolutReader.Api.Bank;
using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Account;

/// <summary>
/// Reads the balance as the present user (c009 design.md D1). The read time is the TimeProvider's when the bank answered;
/// the rate is the one <see cref="IKorunaRates"/> answers, asked before the bank read and awaited after it, so the two run
/// alongside, whatever the bank answers (c017 design.md D4, D8). A bank failure comes back as the same case. A balance in
/// any currency other than EUR throws <see cref="InvalidOperationException"/>, whose message names neither the amount nor
/// the currency.
/// </summary>
public sealed class ReadBalanceHandler(IBankAccount bank, IKorunaRates rates, TimeProvider time) {
  /// <summary>The account's currency (ISO 4217), as the bank names it.</summary>
  private const string EURO = "EUR";

  /// <exception cref="InvalidOperationException">The bank answered a balance in another currency than euros: a bug.</exception>
  public async Task<BankResult<AccountBalance>> Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    Task<KorunaRate> asking = rates.Current(cancellationToken);
    BankResult<Balance> read = await bank.ReadBalance(user, cancellationToken);
    DateTimeOffset answeredAt = time.GetUtcNow();
    KorunaRate rate = await asking;

    return read switch {
      Balance balance => InEuros(balance, answeredAt, rate),
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
  private static AccountBalance InEuros(Balance balance, DateTimeOffset readAt, KorunaRate rate) {
    if (!string.Equals(balance.Currency, EURO, StringComparison.Ordinal))
      throw new InvalidOperationException("The bank answered the balance in a currency other than euros, though the account is a euro account.");

    return new AccountBalance(balance.Amount, readAt, rate.CzkPerEur);
  }
}