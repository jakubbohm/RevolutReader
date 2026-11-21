using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check (c014 design.md D3, D4, D10, D12), as <see cref="IAccountCheck"/> describes it. The kept balances are read
/// first, so a storage failure costs no bank read; then the balance, once, through <see cref="ReadBalanceHandler"/> as the
/// present user (D3, D7).
/// <list type="bullet">
/// <item>With nothing kept, a successful read is kept as both balances, nothing is sent, and the check answers that nothing
/// changed (D4).</item>
/// <item>A failed read keeps nothing new and is the read's failure (D11). A change an earlier check kept is still notified
/// from the stored balances, as below (D10 item 4), unless a check waits behind; with none, nothing is sent.</item>
/// <item>With balances kept, a successful read is kept as last seen, last notified as it was (D4). With no change, nothing
/// is sent and the check answers that nothing changed. A change, with no check waiting behind (D10 item 3), is notified
/// from the stored balances (D10 item 4) through <see cref="ChangeNotifier"/>, and last notified is written as last seen
/// once the sender has run (D10 item 5, D12); a sender that throws leaves it as it was. With a check waiting behind, the
/// change is left to it: nothing is sent and last notified stays as it was. Either way the check answers that the balance
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

#pragma warning disable CA1508 // Its interprocedural analysis follows the reader's returns and calls every arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    return read switch {
      AccountBalance balance => kept is null
        ? await KeepTheFirst(balance, cancellationToken)
        : await KeepAndNotify(kept with { LastSeen = balance }, anotherCheckWaits, cancellationToken),
      BankAccessExpired expired => await ReadFailed(expired, kept, anotherCheckWaits, cancellationToken),
      BankRateLimited rateLimited => await ReadFailed(rateLimited, kept, anotherCheckWaits, cancellationToken),
      BankUnavailable unavailable => await ReadFailed(unavailable, kept, anotherCheckWaits, cancellationToken),
    };
#pragma warning restore CA1508
  }

  /// <summary>
  /// A failed read: nothing new kept, and <paramref name="failure"/>, the read's own, is the result (D11), logged as
  /// <see cref="CheckEnd.BankReadFailed"/> (D15). A change an earlier check kept (<paramref name="kept"/> differing) is still
  /// notified from the stored balances, unless a check waits behind, which it is left to (D10 items 3 and 4); with none,
  /// nothing is sent.
  /// </summary>
  private async Task<BankResult<CheckOutcome>> ReadFailed(BankResult<CheckOutcome> failure, CheckedBalances? kept, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    if (kept is { Changed: true } && !anotherCheckWaits())
      await Notify(kept, cancellationToken);

    CheckLog.CheckEnded(logger, CheckEnd.BankReadFailed);

    return failure;
  }

  /// <summary>The first successful read, with nothing kept: kept as both last seen and last notified, nothing sent (D4).</summary>
  private async Task<CheckOutcome> KeepTheFirst(AccountBalance read, CancellationToken cancellationToken) {
    await store.Save(new CheckedBalances(LastSeen: read, LastNotified: read), cancellationToken);
    CheckLog.CheckEnded(logger, CheckEnd.FirstBalanceKept);

    return new CheckOutcome(Changed: false);
  }

  /// <summary>
  /// A successful read with balances kept: <paramref name="balances"/>, the read as last seen and last notified as it was,
  /// kept (D4); no change sends nothing; a change is left to a check waiting behind, last notified as it was (D10 item 3);
  /// otherwise the change is notified from them and last notified written as last seen once the sender has run (D10, D12).
  /// </summary>
  private async Task<CheckOutcome> KeepAndNotify(CheckedBalances balances, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    await store.Save(balances, cancellationToken);

    if (!balances.Changed) {
      CheckLog.CheckEnded(logger, CheckEnd.Unchanged);

      return new CheckOutcome(Changed: false);
    }

    if (anotherCheckWaits()) {
      CheckLog.CheckEnded(logger, CheckEnd.ChangeLeftToTheNextCheck);

      return new CheckOutcome(Changed: true);
    }

    await Notify(balances, cancellationToken);
    CheckLog.CheckEnded(logger, CheckEnd.ChangeNotified);

    return new CheckOutcome(Changed: true);
  }

  /// <summary>
  /// The change in <paramref name="balances"/>, the stored ones, notified to every allowed account (D5, D10 item 4); last
  /// notified written as last seen once the sender has run, whatever it reached (D10 item 5, D12). A sender that throws
  /// leaves last notified as it was, so the next check sends the change again.
  /// </summary>
  private async Task Notify(CheckedBalances balances, CancellationToken cancellationToken) {
    await notifier.Send(ChangeNotification.For(balances), cancellationToken);
    await store.Save(balances with { LastNotified = balances.LastSeen }, cancellationToken);
  }
}