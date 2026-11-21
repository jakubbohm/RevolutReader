using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>One check (c014 design.md D3, D4, D10, D12), as <see cref="IAccountCheck"/> describes it.</summary>
public sealed class AccountCheck : IAccountCheck {
  public AccountCheck(ReadBalanceHandler reader, ICheckedBalanceStore store, ChangeNotifier notifier, ILogger<AccountCheck> logger) {
    ArgumentNullException.ThrowIfNull(reader);
    ArgumentNullException.ThrowIfNull(store);
    ArgumentNullException.ThrowIfNull(notifier);
    ArgumentNullException.ThrowIfNull(logger);
  }

  public Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) =>
    throw new NotImplementedException();
}