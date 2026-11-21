using System.Globalization;
using System.Text;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What a transactions request answered (spec account-transactions, c010 design.md D10), compared by value, the
/// transactions item by item, so a scenario states the whole expected answer: a page, or a failure's problem
/// description, never both. The driver (<see cref="Drivers.TransactionsDriver"/>) gives a value only when the answer's
/// exact shape fits, a problem's status included (its own table of the status each case belongs to, as
/// <see cref="Drivers.ApiDriver"/>'s), so status codes never reach a scenario (testing.md; as C7a's balance reading).
/// </summary>
/// <param name="Transactions">The page's transactions, in the answer's order; <see langword="null"/> for a failure.</param>
/// <param name="OlderBefore">The day before which older transactions are kept; <see langword="null"/> when nothing older is kept, or for a failure.</param>
/// <param name="CzkPerEur">The koruna rate the page carries; <see langword="null"/> for a failure.</param>
/// <param name="RateDate">
/// The rate's date (c017 design.md D10): a date of the scenario's calendar, shifted back by the driver as the other dates
/// are, from tasks.md 9.2; until then as the answer gives it. <see langword="null"/> for a failure.
/// </param>
/// <param name="Problem">The failure's problem description; <see langword="null"/> for a page.</param>
public sealed record TransactionsReading(
  IReadOnlyList<TransactionSeenInApi>? Transactions,
  DateOnly? OlderBefore,
  decimal? CzkPerEur,
  DateOnly? RateDate,
  ProblemDescription? Problem) {
  /// <summary>
  /// The rate's date exactly as the answer gives it, never shifted (c017 design.md D10): for the app's own rate, whose date
  /// is fixed, not a date of the scenario's calendar. Outside the reading's equality, so a scenario states it apart;
  /// <see langword="null"/> for a failure.
  /// </summary>
  public DateOnly? RateDateAsAnswered { get; init; }

  /// <summary>A page: exactly these transactions, in this order, with what it says of older ones and the rate.</summary>
  public static TransactionsReading Of(IEnumerable<TransactionSeenInApi> transactions, DateOnly? olderBefore, decimal czkPerEur, DateOnly rateDate) =>
    new([.. transactions], olderBefore, czkPerEur, rateDate, Problem: null);

  /// <summary>A failure: this problem description, and no page.</summary>
  public static TransactionsReading Failed(ProblemDescription problem) => new(Transactions: null, OlderBefore: null, CzkPerEur: null, RateDate: null, problem);

  #region Object overrides

  public bool Equals(TransactionsReading? other) =>
    other is not null
    && (Transactions is null ? other.Transactions is null : other.Transactions is not null && Transactions.SequenceEqual(other.Transactions))
    && OlderBefore == other.OlderBefore
    && CzkPerEur == other.CzkPerEur
    && RateDate == other.RateDate
    && Equals(Problem, other.Problem);

  public override int GetHashCode() => HashCode.Combine(Transactions?.Count, OlderBefore, CzkPerEur, RateDate, Problem);

  private bool PrintMembers(StringBuilder builder) {
    builder.Append("Transactions = ");

    if (Transactions is null)
      builder.Append("null");
    else
      builder.Append('[').AppendJoin(", ", Transactions).Append(']');

    builder.Append(CultureInfo.InvariantCulture, $", OlderBefore = {OlderBefore}, CzkPerEur = {CzkPerEur}, RateDate = {RateDate}, Problem = {Problem}, RateDateAsAnswered = {RateDateAsAnswered}");

    return true;
  }

  #endregion
}