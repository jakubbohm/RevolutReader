using System.Globalization;
using System.Text;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What a transactions read came back with (spec bank-reads): the transactions in the order returned, or one of the
/// three failures, which carry none (no partial list). Compared by value, the transactions item by item, so a scenario
/// states the whole expected answer.
/// </summary>
public sealed record TransactionsAnswer(BankOutcome Outcome, IReadOnlyList<TransactionSeen> Transactions) {
  public static TransactionsAnswer AccessExpired { get; } = new(BankOutcome.AccessExpired, []);

  public static TransactionsAnswer RateLimited { get; } = new(BankOutcome.RateLimited, []);

  public static TransactionsAnswer BankUnavailable { get; } = new(BankOutcome.BankUnavailable, []);

  /// <summary>Exactly these transactions, in this order.</summary>
  public static TransactionsAnswer Of(params IEnumerable<TransactionSeen> transactions) => new(BankOutcome.Read, [.. transactions]);

  #region Object overrides

  public bool Equals(TransactionsAnswer? other) => other is not null && Outcome == other.Outcome && Transactions.SequenceEqual(other.Transactions);

  public override int GetHashCode() => HashCode.Combine(Outcome, Transactions.Count);

  private bool PrintMembers(StringBuilder builder) {
    builder.Append(CultureInfo.InvariantCulture, $"Outcome = {Outcome}, Transactions = [").AppendJoin(", ", Transactions).Append(']');

    return true;
  }

  #endregion
}