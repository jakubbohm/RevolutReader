using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The balance through the API, as the scenarios state it (spec account-balance, api-errors; c009 design.md D1): the
/// signed-in user asks for it from her phone, in the browser <see cref="SignInDsl"/> signed in with. What the bank holds
/// or reports, and the requests it received, come from <see cref="BankDsl"/> as they are.
/// <para>
/// Defaults: a request comes from <see cref="BankDsl.DefaultUser"/>'s phone (its address and browser), whose values
/// differ from those of every user a scenario names; a request naming no browser still comes from that phone's address,
/// so only the missing browser can make it fail. A bank the scenario sets nothing up for answers
/// <see cref="BankDsl.DEFAULT_BALANCE"/> EUR (<see cref="BalanceDriver"/>), so a scenario about the user headers needs no
/// balance.
/// </para>
/// </summary>
public sealed class BalanceDsl(BalanceDriver driver) {
  /// <summary>The app's clock, which the answer's read time comes from; it does not move by itself.</summary>
  public DateTimeOffset Now => driver.Now;

  /// <summary>The signed-in user asks the API for the balance from <see cref="BankDsl.DefaultUser"/>'s phone.</summary>
  public Task<BalanceReading> AsksForTheBalance() => AsksForTheBalanceFrom(BankDsl.DefaultUser);

  /// <summary>The signed-in user asks the API for the balance from this phone: its address and its browser.</summary>
  public Task<BalanceReading> AsksForTheBalanceFrom(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return driver.AskForBalance(user);
  }

  /// <summary>A request for the balance comes with the signed-in user's login, from <see cref="BankDsl.DefaultUser"/>'s address, but names no browser.</summary>
  public Task<BalanceReading> AsksForTheBalanceNamingNoBrowser() => driver.AskForBalanceNamingNoBrowser(BankDsl.DefaultUser.IpAddress);

  /// <summary>Every request: the bank answers with an error the app does not know.</summary>
  public void BankAnswersAnErrorTheAppDoesNotKnow() => driver.BankAnswersAnErrorNoCaseFits();
}