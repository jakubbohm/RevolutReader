using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

// logger stays unread until c018 tasks.md 32.1 logs a failure, which removes this pragma.
#pragma warning disable CS9113
/// <summary>
/// The account check's recording of first sightings (c018 design.md D5); scoped, used only by the check. It reads the
/// transactions from the UTC day before the clock's today as the present user and records them through
/// <see cref="FirstSeenTimes"/>, the newest page's path (D1, D2); it keeps no transaction. A bank failure records
/// nothing; logging it, and any exception, instead of throwing comes later (tasks.md 32.1).
/// </summary>
public sealed class RecordFirstSeenHandler(IBankAccount bank, FirstSeenTimes firstSeen, TimeProvider time, ILogger<RecordFirstSeenHandler> logger) {
#pragma warning restore CS9113
  /// <summary>
  /// Reads the transactions from the UTC day before the clock's today as <paramref name="user"/>, never unattended
  /// (ADR-0008 item 3): the date of the clock's UTC moment, whatever offset it is given at (D5). A successful read is
  /// recorded (<see cref="FirstSeenTimes.Record"/>) at <see cref="FirstSeenRule.ReadAt"/> of the clock after the answer;
  /// a bank failure records nothing.
  /// </summary>
  public async Task Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    DateOnly yesterday = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime).AddDays(-1);
    BankResult<Transactions> read = await bank.ReadTransactions(yesterday, user, cancellationToken);

#pragma warning disable CA1508 // Its interprocedural analysis follows the bank's returns and calls every arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
    await (read switch {
      Transactions transactions => Record(transactions.Items, cancellationToken),
      BankAccessExpired or BankRateLimited or BankUnavailable => Task.CompletedTask,
    });
#pragma warning restore CA1508
  }

  /// <summary><paramref name="read"/> recorded at <see cref="FirstSeenRule.ReadAt"/> of the clock now, after the bank's answer.</summary>
  private async Task Record(IReadOnlyList<BankTransaction> read, CancellationToken cancellationToken) {
    _ = await firstSeen.Record(read, FirstSeenRule.ReadAt(time.GetUtcNow()), cancellationToken);
  }
}