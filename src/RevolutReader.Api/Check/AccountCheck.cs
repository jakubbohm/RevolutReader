using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check (c014 design.md D3, D4, D10, D12), as <see cref="IAccountCheck"/> describes it. The kept balances are read
/// first, so a storage failure costs no bank read; then the balance, once, through <see cref="ReadBalanceHandler"/> as the
/// present user (D3, D7).
/// <list type="bullet">
/// <item>With nothing kept, a successful read is kept as both balances, nothing is sent, and the check answers that nothing
/// changed (D4); a failed read keeps nothing and is the read's failure.</item>
/// <item>With balances kept, a successful read is kept as last seen, last notified as it was (D4). With no change, nothing
/// is sent and the check answers that nothing changed. A change, with no check waiting behind (D10 item 3), is notified
/// from the stored balances (D10 item 4) through <see cref="ChangeNotifier"/>, and last notified is written as last seen
/// once the sender has run (D10 item 5, D12); a sender that throws leaves it as it was. The check answers that the balance
/// changed.</item>
/// </list>
/// What it came to is logged (<see cref="CheckLog.CheckEnded"/>), never an amount (D15).
/// </summary>
public sealed class AccountCheck(ReadBalanceHandler reader, ICheckedBalanceStore store, ChangeNotifier notifier, ILogger<AccountCheck> logger) : IAccountCheck {
  public async Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);
    ArgumentNullException.ThrowIfNull(anotherCheckWaits);

    CheckedBalances? kept = await store.Read(cancellationToken);
    BankResult<AccountBalance> read = await reader.Handle(user, cancellationToken);

    if (kept is not null && read is not AccountBalance)
      throw new NotImplementedException("A failed read with balances kept comes with c014 tasks.md groups 29 and 33.");

#pragma warning disable CA1508 // Its interprocedural analysis follows the reader's returns and calls every arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    return read switch {
      AccountBalance balance => kept is null
        ? await KeepTheFirst(balance, cancellationToken)
        : await KeepAndNotify(kept with { LastSeen = balance }, anotherCheckWaits, cancellationToken),
      BankAccessExpired expired => expired,
      BankRateLimited rateLimited => rateLimited,
      BankUnavailable unavailable => unavailable,
    };
#pragma warning restore CA1508
  }

  /// <summary>The first successful read, with nothing kept: kept as both last seen and last notified, nothing sent (D4).</summary>
  private async Task<CheckOutcome> KeepTheFirst(AccountBalance read, CancellationToken cancellationToken) {
    await store.Save(new CheckedBalances(LastSeen: read, LastNotified: read), cancellationToken);
    CheckLog.CheckEnded(logger, CheckEnd.FirstBalanceKept);

    return new CheckOutcome(Changed: false);
  }

  /// <summary>
  /// A successful read with balances kept: <paramref name="balances"/>, the read as last seen and last notified as it was,
  /// kept (D4); no change sends nothing; otherwise, unless a check waits behind, the change notified from them and last
  /// notified written as last seen once the sender has run (D10, D12).
  /// </summary>
  private async Task<CheckOutcome> KeepAndNotify(CheckedBalances balances, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    await store.Save(balances, cancellationToken);

    if (!balances.Changed) {
      CheckLog.CheckEnded(logger, CheckEnd.Unchanged);

      return new CheckOutcome(Changed: false);
    }

    if (anotherCheckWaits())
      throw new NotImplementedException("A change left to the check waiting behind comes with c014 tasks.md group 35.");

    await notifier.Send(ChangeNotification.For(balances), cancellationToken);
    await store.Save(balances with { LastNotified = balances.LastSeen }, cancellationToken);
    CheckLog.CheckEnded(logger, CheckEnd.ChangeNotified);

    return new CheckOutcome(Changed: true);
  }
}