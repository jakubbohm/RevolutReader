using RevolutReader.Api.Bank;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The bank port as an account check reads it (c014 design.md D3; c018 design.md D5, D10): every balance read answers
/// <paramref name="balance"/>, every transactions read answers <see cref="TransactionsListed"/> (by default no transaction),
/// whatever day it asks from, and each read records who it was for as it
/// starts (<see cref="BalanceReadsFor"/>, <see cref="TransactionReadsFor"/>), a transactions read also the day it asked
/// from (<see cref="TransactionReadsFrom"/>). Either answer can be held until the test
/// releases it, so a test sees what runs alongside a held read, as c017's rate tests hold theirs. Safe for reads on several
/// threads at once.
/// </summary>
public sealed class StubCheckBank(BankResult<Balance> balance) : IBankAccount {
  /// <summary>How long <see cref="TransactionsAreRead"/> waits on the real clock: far longer than a check takes to start a read.</summary>
  private const int WITHIN_SECONDS = 10;

  private readonly Lock _lock = new();
  private readonly List<object> _balanceReadsFor = [];
  private readonly List<object> _transactionReadsFor = [];
  private readonly List<DateOnly> _transactionReadsFrom = [];

  /// <summary>Set when the first transactions read starts.</summary>
  private readonly TaskCompletionSource _transactionsRead = NewSignal();

  private TaskCompletionSource? _balanceHeld;
  private TaskCompletionSource? _transactionsHeld;

  /// <summary>What every transactions read answers: these transactions, in this order; none unless the test lists some.</summary>
  public IReadOnlyList<BankTransaction> TransactionsListed { get; init; } = [];

  /// <summary>Who each balance read was for, in order: the trigger's case (a <see cref="PresentUser"/> or <see cref="Unattended"/>).</summary>
  public IReadOnlyList<object> BalanceReadsFor {
    get {
      lock (_lock)
        return [.. _balanceReadsFor];
    }
  }

  /// <summary>Who each transactions read was for, in order: the trigger's case (a <see cref="PresentUser"/> or <see cref="Unattended"/>).</summary>
  public IReadOnlyList<object> TransactionReadsFor {
    get {
      lock (_lock)
        return [.. _transactionReadsFor];
    }
  }

  /// <summary>The day each transactions read asked from, in order.</summary>
  public IReadOnlyList<DateOnly> TransactionReadsFrom {
    get {
      lock (_lock)
        return [.. _transactionReadsFrom];
    }
  }

  /// <summary>Balance reads from now on wait for <see cref="ReleaseTheBalance"/> before they answer.</summary>
  public void HoldTheBalance() {
    lock (_lock)
      _balanceHeld ??= NewSignal();
  }

  /// <summary>Every held balance read answers now.</summary>
  public void ReleaseTheBalance() {
    lock (_lock)
      _ = _balanceHeld?.TrySetResult();
  }

  /// <summary>Transactions reads from now on wait for <see cref="ReleaseTheTransactions"/> before they answer.</summary>
  public void HoldTheTransactions() {
    lock (_lock)
      _transactionsHeld ??= NewSignal();
  }

  /// <summary>Every held transactions read answers now.</summary>
  public void ReleaseTheTransactions() {
    lock (_lock)
      _ = _transactionsHeld?.TrySetResult();
  }

  /// <summary>
  /// Whether a transactions read has started, or starts within 10 s: a bounded wait on the real clock that wakes when the
  /// read starts, never a fixed pause.
  /// </summary>
  public async Task<bool> TransactionsAreRead() {
    try {
      await _transactionsRead.Task.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

      return true;
    }
    catch (TimeoutException) {
      return false;
    }
  }

  public async Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
    TaskCompletionSource? held;

    lock (_lock) {
      _balanceReadsFor.Add(trigger.Value!);
      held = _balanceHeld;
    }

    if (held is not null)
      await held.Task.WaitAsync(cancellationToken);

    return balance;
  }

  public async Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) {
    TaskCompletionSource? held;

    lock (_lock) {
      _transactionReadsFor.Add(trigger.Value!);
      _transactionReadsFrom.Add(from);
      held = _transactionsHeld;
    }

    _ = _transactionsRead.TrySetResult();

    if (held is not null)
      await held.Task.WaitAsync(cancellationToken);

    return new Transactions(TransactionsListed);
  }

  private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}