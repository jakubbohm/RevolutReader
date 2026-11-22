using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The account check, as the scenarios state it (spec account-check, c014 design.md D16): the owner's phone, through its
/// iPhone Shortcut, asks for a check with the check key; someone asks with a wrong key; a request names no browser; checks
/// arrive while the first is still reading the bank; the phone stops waiting. The check's two kept balances, last seen and
/// last notified, are written into and read from the app's own store. What the bank holds or reports, and what it
/// received, come from <see cref="BankDsl"/>; the phones the notification reaches, from <see cref="PushDsl"/>.
/// <para>
/// Defaults: a check comes from <see cref="DefaultPhone"/>, whose address and browser name differ from those of every phone
/// a scenario names; a request naming no browser and one with a wrong key come from that phone too, so only the missing
/// browser or the key can make them fail. Kept balances are at the rate they were read at (<see cref="CZK_PER_EUR"/>),
/// last seen read an hour before the app's clock, last notified with it when the two are equal (as a notification writes
/// it) and two hours before otherwise, so a notification that carried a kept read time instead of its own read's is told
/// apart.
/// </para>
/// </summary>
public sealed class CheckDsl(AccountCheckDriver driver) {
  /// <summary>
  /// The rate the kept balances were read at, koruna per euro: a stored value, kept with each read as an earlier check
  /// left it (c017 design.md D10), not the rate the app answers now, which comes from the fake CNB.
  /// </summary>
  private const decimal CZK_PER_EUR = 24.3m;

  /// <summary>How long before the app's clock a kept last seen was read.</summary>
  private static readonly TimeSpan _lastSeenAge = TimeSpan.FromHours(1);

  /// <summary>How long before the app's clock a kept last notified that differs from last seen was read.</summary>
  private static readonly TimeSpan _olderLastNotifiedAge = TimeSpan.FromHours(2);

  /// <summary>
  /// The owner's iPhone, whose Shortcut asks for a check unless the scenario names another phone: a documentation address
  /// (RFC 5737) and the Shortcut's browser name at another version than any a scenario names (made up), so a check that
  /// goes out with this phone's values instead of a named phone's fails that scenario (lessons.md R-15).
  /// </summary>
  public static UserAtDevice DefaultPhone { get; } = new("203.0.113.42", "BackgroundShortcutRunner/5108.1");

  /// <summary>The app's clock, which a check's read time comes from; it does not move by itself.</summary>
  public DateTimeOffset Now => driver.Now;

  // The check's kept balances (GIVEN)

  /// <summary>The check has kept no balance yet: the app's store holds neither; throws otherwise, so a scenario never rests on a state it only assumes.</summary>
  public async Task HasKeptNothing() {
    if (await driver.KeepsAnyBalance())
      throw new InvalidOperationException("The scenario needs the check to have kept no balance yet, but the app's store holds one.");
  }

  /// <summary>
  /// The check's last seen balance is <paramref name="lastSeen"/> EUR and its last notified <paramref name="lastNotified"/>
  /// EUR, written into the app's store as checks would have left them, read at the times and the rate the class describes.
  /// </summary>
  public Task HasKept(decimal lastSeen, decimal lastNotified) {
    DateTimeOffset lastSeenReadAt = Now - _lastSeenAge;
    DateTimeOffset lastNotifiedReadAt = lastNotified == lastSeen ? lastSeenReadAt : Now - _olderLastNotifiedAge;

    return driver.Keep(lastSeen, lastSeenReadAt, lastNotified, lastNotifiedReadAt, CZK_PER_EUR);
  }

  // Asking for a check (WHEN)

  /// <summary>The owner's phone (<see cref="DefaultPhone"/>) asks for a check with the check key.</summary>
  public Task<CheckAnswer> PhoneAsksForACheck() => PhoneAsksForACheckFrom(DefaultPhone);

  /// <summary>The owner's phone asks for a check with the check key, from this phone: its address and its browser name.</summary>
  public Task<CheckAnswer> PhoneAsksForACheckFrom(UserAtDevice phone) {
    ArgumentNullException.ThrowIfNull(phone);

    return driver.Check(phone);
  }

  /// <summary>A request asks for a check with the check key, from <see cref="DefaultPhone"/>'s address, but names no browser.</summary>
  public Task<CheckAnswer> AsksForACheckNamingNoBrowser() => driver.CheckNamingNoBrowser(DefaultPhone.IpAddress);

  /// <summary>Someone asks for a check with a wrong check key, from <see cref="DefaultPhone"/>.</summary>
  public Task<WholeAnswer> SomeoneAsksWithAWrongKey() => driver.CheckWithAWrongKey(DefaultPhone);

  /// <summary>What an unknown <c>/api</c> address answers the same request the last check with a wrong key was.</summary>
  public Task<WholeAnswer> AnUnknownApiAddressAnswers() => driver.SendTheSameToAnUnknownApiAddress();

  /// <summary>
  /// The owner's phone asks for a check, and <paramref name="checks"/> more checks arrive from it while the first is still
  /// reading the bank (so <paramref name="checks"/> + 1 calls in all); every call's answer, the first first.
  /// </summary>
  public Task<IReadOnlyList<CheckAnswer>> ChecksArriveWhileTheFirstReadsTheBank(int checks) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(checks);

    return driver.ChecksWhileTheFirstReadsTheBank(DefaultPhone, checks);
  }

  /// <summary>The owner's phone asks for a check and stops waiting for the answer while the check is still reading the bank.</summary>
  public Task PhoneStopsWaitingWhileTheCheckReadsTheBank() => driver.CheckThenStopWaitingWhileTheBankReads(DefaultPhone);
}