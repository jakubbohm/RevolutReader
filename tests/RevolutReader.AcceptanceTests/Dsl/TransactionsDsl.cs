using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The transactions through the API, as the scenarios state them (spec account-transactions, c010 design.md D10, D12):
/// the scenario's calendar, what the bank lists, what the app already keeps, the signed-in user asking for the newest
/// transactions or for older ones from her phone, in the browser <see cref="SignInDsl"/> signed in with, and the day the
/// bank was asked from. What the bank reports otherwise and the requests it received come from <see cref="BankDsl"/> as
/// they are.
/// <para>
/// Every date is the scenario's. The harness clock starts at the real time and only moves forward, so the scenario's
/// today is mapped onto the clock's today and every other date keeps its distance in days (<see cref="ScenarioCalendar"/>);
/// the driver shifts what goes to the app and to the fake bank, and shifts back what comes out.
/// </para>
/// <para>
/// Defaults: the scenario's today is <see cref="DefaultToday"/> unless it names another (<see cref="TodayIs"/>); a request
/// comes from <see cref="BankDsl.DefaultUser"/>'s phone, whose address and browser differ from those of every user a
/// scenario names; a request naming no browser still comes from that phone's address, so only the missing browser can
/// make it fail; a settled transaction the bank lists without a reference gets a unique made-up one, as Revolut's settled
/// transactions always carry one (c010 design.md D5); each kept transaction gets a unique made-up reference; a bank the
/// scenario sets nothing up for lists no transactions (<see cref="TransactionsDriver"/>).
/// </para>
/// </summary>
public sealed class TransactionsDsl(TransactionsDriver driver, ScenarioCalendar calendar) {
  /// <summary>The counterparty of the payments <see cref="KeptOnDay"/> makes up: one of the spec's made-up shops.</summary>
  private const string MADE_UP_COUNTERPARTY = "Knihkupectví Luxor";

  /// <summary>The scenario's today unless it names another: the day the spec's scenarios call today.</summary>
  public static DateOnly DefaultToday { get; } = new(2026, 11, 20);

  // The calendar (GIVEN)

  /// <summary>The scenario's today is <paramref name="scenarioToday"/>. Before any step that names a date.</summary>
  public void TodayIs(DateOnly scenarioToday) => calendar.TodayIs(scenarioToday);

  /// <summary>This many days pass on the app's clock, and the scenario's today moves with it. Only after signing in (<see cref="SignInDsl.DaysPass"/>).</summary>
  public void DaysPass(int days) => calendar.PassDays(days);

  // What the bank lists and what the app keeps (GIVEN)

  /// <summary>The bank lists these transactions, in this order, for whatever day it is asked from; it replaces what it listed before. None: it lists nothing.</summary>
  public void BankLists(params IEnumerable<TransactionAtBank> transactions) {
    ArgumentNullException.ThrowIfNull(transactions);

    driver.BankLists([.. transactions.Select(WithAReferenceWhenBooked)]);
  }

  /// <summary>The app keeps these settled transactions; within a day, in the order given.</summary>
  public Task Kept(params IEnumerable<KeptAtApp> transactions) => driver.Keep(transactions);

  /// <summary>The app keeps <paramref name="count"/> different settled payments on <paramref name="day"/>, made up.</summary>
  public Task KeptOnDay(DateOnly day, int count) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(count);

    return driver.Keep(Enumerable.Range(1, count).Select(number => new KeptAtApp(day, -(1.00m + (number / 100m)), MADE_UP_COUNTERPARTY)));
  }

  // Asking (WHEN)

  /// <summary>The signed-in user asks the API for her newest transactions from <see cref="BankDsl.DefaultUser"/>'s phone.</summary>
  public Task<TransactionsReading> AsksForTheTransactions() => AsksForTheTransactionsFrom(BankDsl.DefaultUser);

  /// <summary>The signed-in user asks the API for her newest transactions from this phone: its address and its browser.</summary>
  public Task<TransactionsReading> AsksForTheTransactionsFrom(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return driver.AskForNewest(user);
  }

  /// <summary>A request for the newest transactions comes with the signed-in user's login, from <see cref="BankDsl.DefaultUser"/>'s address, but names no browser.</summary>
  public Task<TransactionsReading> AsksForTheTransactionsNamingNoBrowser() => driver.AskForNewestNamingNoBrowser(BankDsl.DefaultUser.IpAddress);

  /// <summary>The signed-in user asks the API for her transactions before <paramref name="day"/> (an older page).</summary>
  public Task<TransactionsReading> AsksForTheTransactionsBefore(DateOnly day) => driver.AskForOlder(day);

  // What the bank was asked (THEN)

  /// <summary>The day each transactions request the bank received asked from, in the order received.</summary>
  public IReadOnlyList<DateOnly> DaysTheBankWasAskedFrom() => driver.DaysTheBankWasAskedFrom();

  /// <summary>A booked transaction without a reference gets a unique made-up one; any other stays as the scenario gave it.</summary>
  private static TransactionAtBank WithAReferenceWhenBooked(TransactionAtBank transaction) =>
    transaction is { Status: StatusAtBank.Booked, Reference: null } ? transaction with { Reference = $"c010-{Guid.NewGuid():N}" } : transaction;
}