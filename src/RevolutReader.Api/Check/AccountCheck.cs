using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check (c014 design.md D3, D4, D10, D12), as <see cref="IAccountCheck"/> describes it. The kept balances are read
/// first, so a storage failure costs no bank read; then the balance, once, through <see cref="ReadBalanceHandler"/> as the
/// present user (D3, D7). With nothing kept, a successful read is kept as both balances, nothing is sent, and the check
/// answers that nothing changed (D4); a failed read keeps nothing and is the read's failure. What it came to is logged
/// (<see cref="CheckLog.CheckEnded"/>), never an amount (D15).
/// </summary>
public sealed class AccountCheck : IAccountCheck {
  private readonly ReadBalanceHandler _reader;
  private readonly ICheckedBalanceStore _store;
  private readonly ILogger<AccountCheck> _logger;

  public AccountCheck(ReadBalanceHandler reader, ICheckedBalanceStore store, ChangeNotifier notifier, ILogger<AccountCheck> logger) {
    ArgumentNullException.ThrowIfNull(reader);
    ArgumentNullException.ThrowIfNull(store);
    // Sends a change to every allowed account (D5): kept from c014 tasks.md 15 on, when a check with balances kept notifies.
    ArgumentNullException.ThrowIfNull(notifier);
    ArgumentNullException.ThrowIfNull(logger);

    _reader = reader;
    _store = store;
    _logger = logger;
  }

  public async Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);
    ArgumentNullException.ThrowIfNull(anotherCheckWaits);

    CheckedBalances? kept = await _store.Read(cancellationToken);

    if (kept is not null)
      throw new NotImplementedException("A check with balances already kept comes with c014 tasks.md groups 15, 20, 29, 31 and 33.");

#pragma warning disable CA1508 // Its interprocedural analysis follows the reader's returns and calls every arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    return await _reader.Handle(user, cancellationToken) switch {
      AccountBalance read => await KeepTheFirst(read, cancellationToken),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };
#pragma warning restore CA1508
  }

  /// <summary>The first successful read, with nothing kept: kept as both last seen and last notified, nothing sent (D4).</summary>
  private async Task<CheckOutcome> KeepTheFirst(AccountBalance read, CancellationToken cancellationToken) {
    await _store.Save(new CheckedBalances(LastSeen: read, LastNotified: read), cancellationToken);
    CheckLog.CheckEnded(_logger, CheckEnd.FirstBalanceKept);

    return new CheckOutcome(Changed: false);
  }
}