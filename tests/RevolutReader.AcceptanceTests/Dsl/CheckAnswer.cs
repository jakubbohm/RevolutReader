namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the check endpoint answered the phone (spec account-check, c014 design.md D11), compared by value, so a scenario
/// states the whole expected answer: whether, after the check's read, the check's last seen and last notified balances
/// differ, or a refusal's or a failed bank read's problem description, never both. The driver
/// (<see cref="Drivers.AccountCheckDriver"/>) gives a value only when the answer's exact shape fits one, a problem's status
/// included (its own table of the status each case belongs to), so status codes never reach a scenario.
/// </summary>
/// <param name="Changed">Whether the balance changed (the answer's <c>changed</c>); <see langword="null"/> for a problem.</param>
/// <param name="Problem">The refusal's or the failed bank read's problem description; <see langword="null"/> for an answer that says whether the balance changed.</param>
public sealed record CheckAnswer(bool? Changed, ProblemDescription? Problem) {
  /// <summary>The answer says the balance changed: last seen and last notified differ after the check.</summary>
  public static CheckAnswer BalanceChanged { get; } = new(Changed: true, Problem: null);

  /// <summary>The answer says nothing changed: last seen and last notified are the same after the check.</summary>
  public static CheckAnswer NothingChanged { get; } = new(Changed: false, Problem: null);

  /// <summary>Refused, or the bank read failed, with this problem description, and nothing about a change.</summary>
  public static CheckAnswer Failed(ProblemDescription problem) => new(Changed: null, problem);
}