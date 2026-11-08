using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>
/// Reads the balance as the present user (c009 design.md D1). The read time is the TimeProvider's when the bank answered;
/// the rate is <see cref="KorunaRate.CzkPerEur"/> (C13). A bank failure comes back as the same case. A balance in any
/// currency other than EUR throws <see cref="InvalidOperationException"/>, whose message names neither the amount nor the
/// currency.
/// </summary>
#pragma warning disable CS9113 // A stub until Handle is written (c009 tasks.md group 2), which reads both; then this goes.
public sealed class ReadBalanceHandler(IBankAccount bank, TimeProvider time) {
#pragma warning restore CS9113
  public Task<BankResult<AccountBalance>> Handle(PresentUser user, CancellationToken cancellationToken) => throw new NotImplementedException();
}