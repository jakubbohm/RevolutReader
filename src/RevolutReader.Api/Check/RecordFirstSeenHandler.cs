using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

// firstSeen stays unread until c018 tasks.md 28.1 records the answer, logger until 32.1 logs a failure; 32.1 removes this pragma.
#pragma warning disable CS9113
/// <summary>
/// The account check's recording of first sightings (c018 design.md D5); scoped, used only by the check. For now it reads
/// the transactions from the UTC day before the clock's today as the present user and does nothing with the answer;
/// recording the answer through <see cref="FirstSeenTimes"/> (tasks.md 28.1) and logging a failure instead of throwing
/// (32.1) come later.
/// </summary>
public sealed class RecordFirstSeenHandler(IBankAccount bank, FirstSeenTimes firstSeen, TimeProvider time, ILogger<RecordFirstSeenHandler> logger) {
#pragma warning restore CS9113
  /// <summary>
  /// Reads the transactions from the UTC day before the clock's today as <paramref name="user"/>, never unattended
  /// (ADR-0008 item 3): the date of the clock's UTC moment, whatever offset it is given at (D5).
  /// </summary>
  public async Task Handle(PresentUser user, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);

    DateOnly yesterday = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime).AddDays(-1);
    _ = await bank.ReadTransactions(yesterday, user, cancellationToken);
  }
}