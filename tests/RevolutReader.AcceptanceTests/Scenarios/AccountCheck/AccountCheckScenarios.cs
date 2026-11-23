using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.AccountCheck;

/// <summary>
/// The notification's texts are written as the app writes amounts (c014 design.md D2): a no-break space (U+00A0, written
/// <c>\u00A0</c> here) before "€" and "Kč", after "≈" and between thousands; an ordinary space after "Odešlo", "Přišlo" and
/// "Zůstatek" and before "(". The spec shows them as ordinary spaces.
/// </summary>
public sealed class AccountCheckScenarios : AcceptanceTest {
  [Test, Scenario("account-check", "A check without the right key gets the answer of an unknown address")]
  public async Task A_check_without_the_right_key_gets_the_answer_of_an_unknown_address() {
    Bank.HasAvailableBalance(45.20m, "EUR");

    WholeAnswer answer = await Check.SomeoneAsksWithAWrongKey();

    answer.Problem.ShouldBe(ProblemDescription.NotFound);
    answer.ShouldBe(await Check.AnUnknownApiAddressAnswers());
    Bank.RequestsReceived().ShouldBeEmpty("the bank receives no request");
  }

  [Test, Scenario("account-check", "The bank sees the phone's address and browser name")]
  public async Task The_bank_sees_the_phones_address_and_browser_name() {
    UserAtDevice phone = new("203.0.113.7", "BackgroundShortcutRunner/5114.0");

    await Check.PhoneAsksForACheckFrom(phone);

    Bank.BalanceRequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(phone)], "one balance request, as from that phone");
    Bank.TransactionsRequestsReceived().ShouldBe([RequestAtBank.WithUserHeadersOf(phone)], "one transactions request, as from that phone");
    Bank.RequestsReceived().Count.ShouldBe(2, "nothing but the balance and the transactions is read");
  }

  [Test, Scenario("account-check", "A check that names no browser reads nothing at the bank")]
  public async Task A_check_that_names_no_browser_reads_nothing_at_the_bank() {
    (await Check.AsksForACheckNamingNoBrowser()).ShouldBe(CheckAnswer.Failed(ProblemDescription.BadRequest));
    Bank.RequestsReceived().ShouldBeEmpty("the bank receives no request");
  }

  [Test, Scenario("account-check", "The first check sends nothing")]
  public async Task The_first_check_sends_nothing() {
    await Check.HasKeptNothing();
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");

    CheckAnswer answer = await Check.PhoneAsksForACheck();

    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone receives nothing");
    answer.ShouldBe(CheckAnswer.NothingChanged);
  }

  [Test, Scenario("account-check", "Money out is notified with the new balance")]
  public async Task Money_out_is_notified_with_the_new_balance() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");
    Rate.TheCnbsLatestRateIs(24.6m);

    CheckAnswer answer = await Check.PhoneAsksForACheck();

    PushReceived notification = Push.Received(phone).ShouldHaveSingleItem();
    notification.Title.ShouldBe("Odešlo 3,80\u00A0€");
    notification.Text.ShouldBe("Zůstatek 45,20\u00A0€ (≈\u00A01\u00A0112\u00A0Kč)");
    notification.Navigate.ShouldBe(Push.AppAddressOf("/"));
    answer.ShouldBe(CheckAnswer.BalanceChanged);
  }

  [Test, Scenario("account-check", "Money in is notified with the new balance")]
  public async Task Money_in_is_notified_with_the_new_balance() {
    await Check.HasKept(lastSeen: 45.20m, lastNotified: 45.20m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(145.20m, "EUR");
    Rate.TheCnbsLatestRateIs(24.6m);

    await Check.PhoneAsksForACheck();

    PushReceived notification = Push.Received(phone).ShouldHaveSingleItem();
    notification.Title.ShouldBe("Přišlo 100,00\u00A0€");
    notification.Text.ShouldBe("Zůstatek 145,20\u00A0€ (≈\u00A03\u00A0572\u00A0Kč)");
  }

  [Test, Scenario("account-check", "An unchanged balance sends nothing")]
  public async Task An_unchanged_balance_sends_nothing() {
    await Check.HasKept(lastSeen: 45.20m, lastNotified: 45.20m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");

    CheckAnswer answer = await Check.PhoneAsksForACheck();

    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone receives nothing");
    answer.ShouldBe(CheckAnswer.NothingChanged);
  }

  [Test, Scenario("account-check", "Every allowed account with a registered device gets the notification")]
  public async Task Every_allowed_account_with_a_registered_device_gets_the_notification() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    Bank.HasAvailableBalance(45.20m, "EUR");
    PhoneForPush luciesPhone = Push.NewPhone("Lucie's phone");
    PhoneForPush petrsPhone = Push.NewPhone("Petr's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(luciesPhone);
    SignIn.IsOnTheAllowlist(Visitor.Petr.Email);
    await SignIn.HasSignedIn(Visitor.Petr);
    await Push.HasRegistered(petrsPhone);

    await Check.PhoneAsksForACheck();

    Push.Received(luciesPhone).ShouldHaveSingleItem().Title.ShouldBe("Odešlo 3,80\u00A0€");
    Push.Received(petrsPhone).ShouldHaveSingleItem().Title.ShouldBe("Odešlo 3,80\u00A0€");
  }

  [Test, Scenario("account-check", "The notification carries the new balance for the phone to keep")]
  public async Task The_notification_carries_the_new_balance_for_the_phone_to_keep() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");
    Rate.TheCnbsLatestRateIs(24.6m);

    await Check.PhoneAsksForACheck();

    PushReceived notification = Push.Received(phone).ShouldHaveSingleItem();
    notification.MarkedForServiceWorker.ShouldBeTrue("marked for the app's service worker");
    notification.Balance.ShouldBe(BalanceReading.Of(45.20m, readAt: Check.Now, czkPerEur: 24.6m));
  }

  [Test, Scenario("account-check", "A failed bank read sends nothing and answers as the balance does")]
  public async Task A_failed_bank_read_sends_nothing_and_answers_as_the_balance_does() {
    await Check.HasKept(lastSeen: 45.20m, lastNotified: 45.20m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.ReportsOwnError();

    (await Check.PhoneAsksForACheck()).ShouldBe(CheckAnswer.Failed(ProblemDescription.BankUnavailable));
    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone receives nothing");
  }

  [Test, Scenario("account-check", "A burst of checks sends one notification and reads the bank at most twice")]
  public async Task A_burst_of_checks_sends_one_notification_and_reads_the_bank_at_most_twice() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");

    await Check.ChecksArriveWhileTheFirstReadsTheBank(3);

    Bank.BalanceRequestsReceived().Count.ShouldBe(2, "the bank receives two balance requests");
    Bank.TransactionsRequestsReceived().Count.ShouldBe(2, "the bank receives two transactions requests");
    Push.Received(phone).ShouldHaveSingleItem().Title.ShouldBe("Odešlo 3,80\u00A0€");
  }

  [Test, Scenario("account-check", "A check whose bank read fails still sends what an earlier check found")]
  public async Task A_check_whose_bank_read_fails_still_sends_what_an_earlier_check_found() {
    await Check.HasKept(lastSeen: 45.20m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.ReportsOwnError();

    await Check.PhoneAsksForACheck();

    PushReceived notification = Push.Received(phone).ShouldHaveSingleItem();
    notification.Title.ShouldBe("Odešlo 3,80\u00A0€");
    notification.Text.ShouldBe("Zůstatek 45,20\u00A0€ (≈\u00A01\u00A0098\u00A0Kč)");
  }

  [Test, Scenario("account-check", "A check goes on when its caller stops waiting")]
  public async Task A_check_goes_on_when_its_caller_stops_waiting() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");

    await Check.PhoneStopsWaitingWhileTheCheckReadsTheBank();

    (await Push.Eventually(phone, pushes: 1)).ShouldHaveSingleItem().Title.ShouldBe("Odešlo 3,80\u00A0€");
  }

  [Test, Scenario("account-check", "A change is not notified again after a device's push failed")]
  public async Task A_change_is_not_notified_again_after_a_devices_push_failed() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    Bank.HasAvailableBalance(45.20m, "EUR");
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Push.PushServiceFailsOnce(phone);

    await Check.PhoneAsksForACheck();
    CheckAnswer second = await Check.PhoneAsksForACheck();

    Push.PushServiceReceived(phone).ShouldHaveSingleItem("her phone's push service receives only the first push");
    second.ShouldBe(CheckAnswer.NothingChanged);
  }

  // The check also reads the recent transactions, for their first-seen times only (c018).

  [Test, Scenario("account-check", "The check reads the transactions from yesterday on")]
  public async Task The_check_reads_the_transactions_from_yesterday_on() {
    Transactions.TodayIs(new DateOnly(2026, 11, 20));

    await Check.PhoneAsksForACheck();

    Transactions.DaysTheBankWasAskedFrom().ShouldBe([new DateOnly(2026, 11, 19)]);
  }

  [Test, Scenario("account-check", "A payment a check reads first carries the check's time")]
  public async Task A_payment_a_check_reads_first_carries_the_checks_time() {
    // Lucie signs in first: the time of day is set after signing in, as the clock starts at the real time, which
    // Microsoft's ID token is checked against.
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.TodayIsAt(new DateOnly(2026, 11, 20), new TimeOnly(13, 5, 12));
    Transactions.BankLists(TransactionAtBank.Payment(StatusAtBank.Pending, 8.90m, on: new DateOnly(2026, 11, 20), to: "Kavárna Na Rohu", reference: "e-c018-311"));

    await Check.PhoneAsksForACheck();
    Transactions.TimeIs(new TimeOnly(13, 20, 0));
    TransactionsReading reading = await Transactions.AsksForTheTransactions();

    reading.Transactions.ShouldBe([
      TransactionSeenInApi.StillPending(-8.90m, on: new DateOnly(2026, 11, 20), counterparty: "Kavárna Na Rohu", seenAt: new DateTimeOffset(2026, 11, 20, 13, 5, 12, TimeSpan.Zero)),
    ]);
  }

  [Test, Scenario("account-check", "Transactions a check reads are not kept")]
  public async Task Transactions_a_check_reads_are_not_kept() {
    UserAtDevice herPhone = new("198.51.100.77", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");
    Transactions.TodayIs(new DateOnly(2026, 11, 20));
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Transactions.Kept(new KeptAtApp(new DateOnly(2026, 9, 30), -4.20m));
    Transactions.BankLists(TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 19), reference: "e-c018-312"));

    await Check.PhoneAsksForACheck();
    await Transactions.AsksForTheTransactionsFrom(herPhone);

    Transactions.DaysTheBankWasAskedFromBy(herPhone).ShouldBe([new DateOnly(2026, 9, 30)], "her read asks the bank from the newest kept day");
  }

  [Test, Scenario("account-check", "A failed transactions read leaves the check's notification and answer as they were")]
  public async Task A_failed_transactions_read_leaves_the_checks_notification_and_answer_as_they_were() {
    await Check.HasKept(lastSeen: 49.00m, lastNotified: 49.00m);
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Bank.HasAvailableBalance(45.20m, "EUR");
    Bank.ReportsOwnErrorForTransactions();

    CheckAnswer answer = await Check.PhoneAsksForACheck();

    Push.Received(phone).ShouldHaveSingleItem().Title.ShouldBe("Odešlo 3,80\u00A0€");
    answer.ShouldBe(CheckAnswer.BalanceChanged);
  }
}