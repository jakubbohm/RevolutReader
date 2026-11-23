using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// The account check's recording of first sightings (c018 design.md D5); scoped, used only by the check. It reads the
/// transactions from the UTC day before the clock's today as the present user and records them through
/// <see cref="FirstSeenTimes"/>, the newest page's path (D1, D2); it keeps no transaction. It is a side task of the check:
/// it never throws but for the caller's cancellation, so the check's notification and answer stay the balance path's.
/// </summary>
public sealed class RecordFirstSeenHandler(IBankAccount bank, FirstSeenTimes firstSeen, TimeProvider time, ILogger<RecordFirstSeenHandler> logger) {
  /// <summary>
  /// Reads the transactions from the UTC day before the clock's today as <paramref name="user"/>, never unattended
  /// (ADR-0008 item 3): the date of the clock's UTC moment, whatever offset it is given at (D5). A successful read is
  /// recorded (<see cref="FirstSeenTimes.Record"/>) at <see cref="FirstSeenRule.ReadAt"/> of the clock after the answer.
  /// Never throws but for <paramref name="cancellationToken"/>: a bank failure records nothing and logs
  /// <see cref="CheckLog.FirstSeenNotRecorded"/> with its kind; any exception while reading or recording, a cancellation
  /// the caller did not ask for included, logs the same event as <see cref="FirstSeenFailure.Failed"/>, with the exception
  /// (§ Error model). Only the caller's cancellation passes, as <see cref="OperationCanceledException"/>.
  /// </summary>
  public async Task Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    try {
      DateOnly yesterday = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime).AddDays(-1);
      BankResult<Transactions> read = await bank.ReadTransactions(yesterday, user, cancellationToken);

#pragma warning disable CA1508 // Its interprocedural analysis follows the bank's returns and calls every arm always true; each case is named, so a case added to the union later is a compile error rather than a silent default.
      await (read switch {
        Transactions transactions => Record(transactions.Items, cancellationToken),
        BankAccessExpired => NotRecorded(FirstSeenFailure.BankAccessExpired),
        BankRateLimited => NotRecorded(FirstSeenFailure.BankRateLimited),
        BankUnavailable => NotRecorded(FirstSeenFailure.BankUnavailable),
      });
#pragma warning restore CA1508
    }
#pragma warning disable CA1031 // The recording is a side task of the check and never changes its notification or answer (D5): any failure, of whatever type, is logged and the check goes on; only the caller's own cancellation passes.
    catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested) {
      CheckLog.FirstSeenNotRecordedWithException(logger, FirstSeenFailure.Failed, exception);
    }
#pragma warning restore CA1031
  }

  /// <summary><paramref name="read"/> recorded at <see cref="FirstSeenRule.ReadAt"/> of the clock now, after the bank's answer.</summary>
  private async Task Record(IReadOnlyList<BankTransaction> read, CancellationToken cancellationToken) {
    _ = await firstSeen.Record(read, FirstSeenRule.ReadAt(time.GetUtcNow()), cancellationToken);
  }

  /// <summary>A bank failure of the read, by its kind: nothing recorded, the kind logged (D5).</summary>
  private Task NotRecorded(FirstSeenFailure failure) {
    CheckLog.FirstSeenNotRecorded(logger, failure);

    return Task.CompletedTask;
  }
}