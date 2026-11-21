using System.Buffers.Text;
using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using RevolutReader.UnitTests.Push;
using RevolutReader.UnitTests.Rate;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// One account check (c014 design.md D3, D4, D5, D10, D12, D15; § Public API sketch, <see cref="IAccountCheck"/>): it reads
/// the balance once, as the present user; the first successful read, with nothing kept, is kept as both last seen and last
/// notified and sends nothing; a read that differs from last notified, with no check waiting behind, is notified from the
/// stored balances through the sender, and last notified is then written as last seen; the check answers whether the two
/// differ after its read; a failed read keeps nothing and is the read's failure; the check logs what it came to, and never
/// an amount.
/// <para>
/// The setup is design.md D16's: a hand-written stub of the bank port under a real <see cref="ReadBalanceHandler"/> on a
/// <see cref="FakeTimeProvider"/>, its rates answering a rate written out (<see cref="FixedKorunaRates"/>, c017 design.md
/// D10); the in-memory store of the check's balances; a real <see cref="ChangeNotifier"/> over a
/// real <see cref="SendPushHandler"/> with C8a's in-memory device store and stub delivery, whose hand-overs show what was
/// sent. The allowlist holds Lucie and Petr; Lucie has a registered phone, so anything sent would reach it. Every log line
/// of the check, the notifier and the sender goes to one hand-written logger. No check waits behind these ones. The
/// amounts are made up; the address is a documentation address (RFC 5737), the browser name the Shortcut's.
/// </para>
/// </summary>
public sealed class AccountCheckTests {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";

  /// <summary>The made-up app address, <c>Push:Subject</c>, as the sender's own tests set it.</summary>
  private const string APP_ADDRESS = "https://app.example.net";

  /// <summary>The push settings the sender never reads when it sends: the keys are the delivery's business.</summary>
  private const string NOT_READ_WHEN_SENDING = "made up, not read by the sender";

  /// <summary>
  /// The rate every balance here is read at, written out (c017 design.md D10): the rates' (<see cref="FixedKorunaRates"/>)
  /// and the kept balances'; the koruna values the log tests look for are at this rate.
  /// </summary>
  private const decimal CZK_PER_EUR = 24.3m;

  /// <summary>The clock when the bank answers: the read time of every balance read here.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 21, 9, 14, 3, TimeSpan.Zero);

  /// <summary>The owner's phone, as its Shortcut calls: a documentation address and the Shortcut's browser name.</summary>
  private static readonly PresentUser _phone = new(IPAddress.Parse("203.0.113.7"), "BackgroundShortcutRunner/5114.0");

  /// <summary>No check waits behind the one under test (D10's seam).</summary>
  private static readonly Func<bool> _noCheckWaits = static () => false;

  /// <summary>Another check waits behind the one under test (D10's seam).</summary>
  private static readonly Func<bool> _anotherCheckWaits = static () => true;

  /// <summary>Lucie's registered phone, the one device every check here can reach.</summary>
  private static readonly PushDevice _luciesPhone = Device(LUCIE);

  [Test]
  public async Task A_first_successful_read_keeps_the_balance_as_both_last_seen_and_last_notified_and_sends_nothing() {
    InMemoryCheckedBalanceStore store = new();
    StubPushDelivery delivery = new();

    await (await CheckWith(new Balance(45.20m, "EUR"), store, delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    AccountBalance read = new(45.20m, _now, CZK_PER_EUR);
    (await store.Read(CancellationToken.None)).ShouldBe(new CheckedBalances(LastSeen: read, LastNotified: read), "the read, whole, kept as both balances");
    delivery.HandedOver.ShouldBeEmpty("the first check sends nothing");
  }

  [Test]
  public async Task A_first_check_answers_that_nothing_changed() {
    AccountCheck check = await CheckWith(new Balance(45.20m, "EUR"), new InMemoryCheckedBalanceStore(), new StubPushDelivery());

    BankResult<CheckOutcome> result = await check.Run(_phone, _noCheckWaits, CancellationToken.None);

    result.Value.ShouldBe(new CheckOutcome(Changed: false));
  }

  /// <param name="failure">The bank's expected failures (C13): each comes back as the check's result, as it is.</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_first_read_that_fails_keeps_nothing_and_is_the_reads_failure(string failure) {
    BankResult<Balance> answer = failure switch {
      "access expired" => new BankAccessExpired(),
      "rate limited" => new BankRateLimited(),
      "unavailable" => new BankUnavailable(),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    InMemoryCheckedBalanceStore store = new();

    BankResult<CheckOutcome> result = await (await CheckWith(answer, store, new StubPushDelivery())).Run(_phone, _noCheckWaits, CancellationToken.None);

    result.Value.ShouldBe(answer.Value, "the read's failure, as it is");
    (await store.Read(CancellationToken.None)).ShouldBeNull("nothing kept");
  }

  /// <summary>
  /// A first check whose read fails still ends with its line of what it came to (D15: every check's <c>CheckEnded</c>,
  /// <see cref="CheckEnd.BankReadFailed"/> among its values, whether or not balances are kept): exactly one <c>CheckEnded</c>
  /// at Information, whose one value is <see cref="CheckEnd.BankReadFailed"/>, so it carries no amount.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_first_read_that_fails_logs_BankReadFailed(string failure) {
    CapturedLog log = new();

    await (await CheckWith(Failure(failure), new InMemoryCheckedBalanceStore(), new StubPushDelivery(), log)).Run(_phone, _noCheckWaits, CancellationToken.None);

    LogEntry ended = log.Entries.Where(static line => line.EventName == "CheckEnded").ShouldHaveSingleItem("the check's line of what it came to: one");
    ended.ShouldSatisfyAllConditions(
      () => ended.Level.ShouldBe(LogLevel.Information),
      () => ended.OwnValues().Select(static value => value.Value).ShouldBe([CheckEnd.BankReadFailed], "what the check came to, and nothing else: the bank read failed"));
  }

  /// <summary>
  /// The first check's line of what it came to is <c>CheckEnded</c> at Information, whose one value is
  /// <see cref="CheckEnd.FirstBalanceKept"/> (D15); no line of the check, the notifier or the sender holds the amount in any
  /// form (as the API writes it, as the app writes it in Czech, its koruna value) or the time it was read. The amount is
  /// distinctive, so it cannot turn up by coincidence.
  /// </summary>
  [Test]
  public async Task A_check_logs_what_it_came_to_with_no_amount() {
    CapturedLog log = new();
    AccountCheck check = await CheckWith(new Balance(7531.86m, "EUR"), new InMemoryCheckedBalanceStore(), new StubPushDelivery(), log);

    await check.Run(_phone, _noCheckWaits, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    LogEntry ended = lines.Where(static line => line.EventName == "CheckEnded").ShouldHaveSingleItem("the check's line of what it came to: one");
    string[] privateForms = [
      "7531", "7 531", "7\u00A0531", "531.86", "531,86", // the amount, with or without a thousands separator
      "183024", "183 024", "183\u00A0024", // its koruna value at 24.3, 183 024.198
      "2026-11-21", "11/21/2026", "21.11.2026", "9:14:03", // the time it was read
    ];
    ended.ShouldSatisfyAllConditions(
      () => ended.Level.ShouldBe(LogLevel.Information),
      () => ended.OwnValues().Select(static value => value.Value).ShouldBe([CheckEnd.FirstBalanceKept], "what the check came to: it kept the first balance"));
    lines.Where(line => privateForms.Any(form => line.AllText().Contains(form, StringComparison.OrdinalIgnoreCase)))
      .ShouldBeEmpty("no line holds the amount, in any form, or the time it was read");
  }

  /// <summary>
  /// The check reads the balance once, and as the user it runs for: the bank gets that user's address and browser name, and
  /// no other read (spec account-check, "The check reads the balance as the phone present"; D3, D7; tasks.md 12.1). The
  /// user is one no other test here names.
  /// </summary>
  [Test]
  public async Task A_check_reads_the_bank_once_as_the_user_it_runs_for() {
    PresentUser user = new(IPAddress.Parse("203.0.113.42"), "BackgroundShortcutRunner/5108.1");
    StubBankAccount bank = new(new Balance(45.20m, "EUR"));

    await (await CheckWith(bank, new InMemoryCheckedBalanceStore(), new StubPushDelivery())).Run(user, _noCheckWaits, CancellationToken.None);

    bank.ReadsFor.ShouldBe([user], "one balance read, as the user the check runs for: the same address and browser name");
  }

  /// <summary>
  /// Both balances kept at 49.00, read an hour earlier; the bank holds 45.20. The change is notified once, from last
  /// notified's 49.00 to the new last seen (D10 item 4), and last notified is then written as last seen: both the read,
  /// whole (D12).
  /// </summary>
  [Test]
  public async Task A_check_with_no_check_waiting_behind_it_notifies_a_change_from_the_stored_balances_then_writes_last_notified_as_last_seen() {
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 49.00m, lastNotified: 49.00m);
    StubPushDelivery delivery = new();

    await (await CheckWith(new Balance(45.20m, "EUR"), store, delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    delivery.HandedOver.Select(static handedOver => Notification(handedOver.Push).Title).ShouldBe(["Odešlo 3,80\u00A0€"], "the change from 49.00 to 45.20, notified once");
    AccountBalance read = new(45.20m, _now, CZK_PER_EUR);
    (await store.Read(CancellationToken.None)).ShouldBe(new CheckedBalances(LastSeen: read, LastNotified: read), "last notified written as last seen: both the read, whole");
  }

  [Test]
  public async Task A_check_answers_that_the_balance_changed_when_it_found_a_change() {
    AccountCheck check = await CheckWith(new Balance(45.20m, "EUR"), await StoreKeeping(lastSeen: 49.00m, lastNotified: 49.00m), new StubPushDelivery());

    BankResult<CheckOutcome> result = await check.Run(_phone, _noCheckWaits, CancellationToken.None);

    result.Value.ShouldBe(new CheckOutcome(Changed: true));
  }

  /// <summary>
  /// The notification reaches Lucie's registered phone as a push the sender built: the change's title and the new balance's
  /// text (D2), kept for 24 hours and urgent, as the sender hands over every push (D2: the sender's lifetime and urgency).
  /// Every account on the allowlist and their counts are tasks.md group 22's.
  /// </summary>
  [Test]
  public async Task The_change_goes_through_the_sender_to_an_allowed_accounts_device() {
    StubPushDelivery delivery = new();

    await (await CheckWith(new Balance(45.20m, "EUR"), await StoreKeeping(lastSeen: 49.00m, lastNotified: 49.00m), delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    (PushDevice device, OutgoingPush push) = delivery.HandedOver.ShouldHaveSingleItem("one push, to the one registered device");
    device.ShouldBe(_luciesPhone);
    push.ShouldSatisfyAllConditions(
      () => Notification(push).ShouldBe(("Odešlo 3,80\u00A0€", "Zůstatek 45,20\u00A0€ (≈\u00A01\u00A0098\u00A0Kč)")),
      () => push.Lifetime.ShouldBe(TimeSpan.FromHours(24)),
      () => push.Urgency.ShouldBe(PushUrgency.High));
  }

  /// <summary>
  /// A notifying check's lines (D15): <c>CheckEnded</c> at Information whose one value is <see cref="CheckEnd.ChangeNotified"/>,
  /// and one <c>ChangeSent</c> at Information with the four counts by name, accounts, delivered, failed and removed; the
  /// one registered device was reached. How the counts sum over the allowlist's accounts is tasks.md group 22's, so the
  /// accounts' count is not read. No line of the check, the notifier or the sender holds an amount in any form (the kept
  /// balance, the new one, the change, the koruna value), a time read or an account's address. The amounts are distinctive,
  /// so none can turn up by coincidence.
  /// </summary>
  [Test]
  public async Task A_check_that_notified_logs_it_with_counts_and_no_amount() {
    CapturedLog log = new();
    AccountCheck check = await CheckWith(new Balance(6297.30m, "EUR"), await StoreKeeping(lastSeen: 7531.86m, lastNotified: 7531.86m), new StubPushDelivery(), log);

    await check.Run(_phone, _noCheckWaits, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    LogEntry ended = lines.Where(static line => line.EventName == "CheckEnded").ShouldHaveSingleItem("the check's line of what it came to: one");
    LogEntry sent = lines.Where(static line => line.EventName == "ChangeSent").ShouldHaveSingleItem("the line of what the change reached: one");
    string[] privateForms = [
      "7531", "7 531", "7\u00A0531", "531.86", "531,86", // the kept balance, 7 531.86
      "6297", "6 297", "6\u00A0297", "297.3", "297,3", // the new balance, 6 297.30
      "1234", "1 234", "1\u00A0234", "234.56", "234,56", // the change, 1 234.56
      "153024", "153 024", "153\u00A0024", // the new balance's koruna value at 24.3, 153 024.39
      "2026-11-21", "11/21/2026", "21.11.2026", "9:14:03", "8:14:03", // the times the balances were read
      LUCIE, PETR, // the allowlist's accounts
    ];
    lines.ShouldSatisfyAllConditions(
      () => ended.Level.ShouldBe(LogLevel.Information),
      () => ended.OwnValues().Select(static value => value.Value).ShouldBe([CheckEnd.ChangeNotified], "what the check came to: it notified the change"),
      () => sent.Level.ShouldBe(LogLevel.Information),
      () => sent.OwnValues().Select(static value => value.Key).ShouldBe(["accounts", "delivered", "failed", "removed"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "the four counts, by name"),
      () => sent.OwnNamedValues().Where(static value => !value.StartsWith("accounts=", StringComparison.OrdinalIgnoreCase))
        .ShouldBe(["delivered=1", "failed=0", "removed=0"], StringComparer.OrdinalIgnoreCase, ignoreOrder: true, "the one registered device reached"),
      () => lines.Where(line => privateForms.Any(form => line.AllText().Contains(form, StringComparison.OrdinalIgnoreCase)))
        .ShouldBeEmpty("no line holds an amount, in any form, a time read or an account's address"));
  }

  /// <summary>
  /// Both balances kept at 45.20, read an hour earlier; the bank holds 45.20 again. Last seen becomes the new read, whole,
  /// with its own read time (D4: written by every successful read); last notified stays exactly as it was, with its own
  /// earlier read time, since no notification went out (D4: the balance at the last notification). Nothing is sent, the
  /// check answers that nothing changed, and its one line of what it came to is <c>CheckEnded</c> at Information whose one
  /// value is <see cref="CheckEnd.Unchanged"/>, with no amount in any line, in any form, and no time read.
  /// </summary>
  [Test]
  public async Task A_read_equal_to_last_notified_keeps_it_as_last_seen_sends_nothing_and_answers_that_nothing_changed() {
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 45.20m, lastNotified: 45.20m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    StubPushDelivery delivery = new();
    CapturedLog log = new();

    BankResult<CheckOutcome> result = await (await CheckWith(new Balance(45.20m, "EUR"), store, delivery, log)).Run(_phone, _noCheckWaits, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    LogEntry ended = lines.Where(static line => line.EventName == "CheckEnded").ShouldHaveSingleItem("the check's line of what it came to: one");
    string[] privateForms = [
      "45.2", "45,2", // the balance, 45.20
      "1098", "1 098", "1\u00A0098", // its koruna value at 24.3, 1 098.36
      "2026-11-21", "11/21/2026", "21.11.2026", "9:14:03", "8:14:03", // the times the balances were read
    ];
    CheckedBalances after = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    after.ShouldSatisfyAllConditions(
      () => after.LastSeen.ShouldBe(new AccountBalance(45.20m, _now, CZK_PER_EUR), "last seen: the new read, whole, with its own read time"),
      () => after.LastNotified.ShouldBe(before.LastNotified, "last notified: as it was, its earlier read time included"),
      () => delivery.HandedOver.ShouldBeEmpty("nothing is sent"),
      () => result.Value.ShouldBe(new CheckOutcome(Changed: false), "the check answers that nothing changed"),
      () => ended.Level.ShouldBe(LogLevel.Information),
      () => ended.OwnValues().Select(static value => value.Value).ShouldBe([CheckEnd.Unchanged], "what the check came to: nothing changed"),
      () => lines.Where(line => privateForms.Any(form => line.AllText().Contains(form, StringComparison.OrdinalIgnoreCase)))
        .ShouldBeEmpty("no line holds the balance, in any form, or a time read"));
  }

  /// <summary>
  /// Both balances kept at 49.00; the bank holds 45.20; Lucie's phone's push fails, or its push service reports the phone
  /// gone. The sender has run (the push was handed over), so last notified is written as last seen, whatever the push
  /// service answered (D12): the phone misses that notification, and the sender never retries it (ADR-0010).
  /// </summary>
  /// <param name="answer">What Lucie's phone's push service answers: an error of its own, or that the phone is gone.</param>
  [Test]
  [Arguments("failed")]
  [Arguments("gone")]
  public async Task Last_notified_is_written_once_the_sender_has_run_also_when_a_devices_push_failed_or_was_gone(string answer) {
    DeliveryOutcome outcome = answer switch {
      "failed" => new DeliveryFailed(500),
      "gone" => new DeviceGone(410),
      _ => throw new ArgumentOutOfRangeException(nameof(answer), answer, "Not a known case."),
    };
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 49.00m, lastNotified: 49.00m);
    StubPushDelivery delivery = new StubPushDelivery().Answers(_luciesPhone, outcome);

    await (await CheckWith(new Balance(45.20m, "EUR"), store, delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    AccountBalance read = new(45.20m, _now, CZK_PER_EUR);
    delivery.HandedOver.ShouldHaveSingleItem("the sender ran: Lucie's phone was handed its push");
    (await store.Read(CancellationToken.None)).ShouldBe(new CheckedBalances(LastSeen: read, LastNotified: read), "last notified written as last seen, whatever the push service answered");
  }

  /// <summary>
  /// Both balances kept at 49.00; the bank holds 45.20; the sender throws, since the device table cannot be read (D12,
  /// § Error model). The exception reaches the caller, and last notified is left as it was. Once the device table can be
  /// read again, the next check sends the change again: one push, "Odešlo 3,80 €".
  /// </summary>
  [Test]
  public async Task Last_notified_is_left_as_it_was_when_the_sender_throws_so_the_next_check_sends_the_change_again() {
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 49.00m, lastNotified: 49.00m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    FailingDeviceTable devices = new(await DevicesWithLuciesPhone());
    StubPushDelivery delivery = new();
    AccountCheck check = await CheckWith(new StubBankAccount(new Balance(45.20m, "EUR")), store, delivery, devices: devices);

    InvalidOperationException thrown = await Should.ThrowAsync<InvalidOperationException>(() => check.Run(_phone, _noCheckWaits, CancellationToken.None));
    CheckedBalances afterTheFailure = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    devices.Readable = true;
    await check.Run(_phone, _noCheckWaits, CancellationToken.None);

    thrown.ShouldSatisfyAllConditions(
      () => thrown.ShouldBeSameAs(devices.Failure, "the sender's failure reaches the caller as it is"),
      () => afterTheFailure.LastNotified.ShouldBe(before.LastNotified, "last notified left as it was, 49.00"),
      () => delivery.HandedOver.Select(static handedOver => Notification(handedOver.Push).Title).ShouldBe(["Odešlo 3,80\u00A0€"], "the next check sends the change again, once"));
  }

  /// <summary>
  /// An earlier check kept last seen at 45.20 and left last notified at 49.00; this check's bank read fails, and no check
  /// waits behind, so it sends the kept change first (D10 item 4). The sender throws, since the device table cannot be read.
  /// That failure decides the outcome (spec account-check, "A bank failure answers as the balance does": a failed send of a
  /// change an earlier check kept answers as an unexpected failure does; D11, D12): the sender's exception reaches the
  /// caller, not the read's failure as a result, and both kept balances are left exactly as they were. Whether the check
  /// logs its <c>CheckEnded</c> line on this path is not pinned here.
  /// </summary>
  [Test]
  public async Task A_failed_read_whose_catch_up_send_throws_throws_leaving_the_kept_balances_as_they_were() {
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 45.20m, lastNotified: 49.00m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    FailingDeviceTable devices = new(await DevicesWithLuciesPhone());
    AccountCheck check = await CheckWith(new StubBankAccount(Failure("unavailable")), store, new StubPushDelivery(), devices: devices);

    InvalidOperationException thrown = await Should.ThrowAsync<InvalidOperationException>(() => check.Run(_phone, _noCheckWaits, CancellationToken.None));

    CheckedBalances? after = await store.Read(CancellationToken.None);
    thrown.ShouldSatisfyAllConditions(
      () => thrown.ShouldBeSameAs(devices.Failure, "the sender's failure reaches the caller as it is, not the read's failure as a result"),
      () => after.ShouldBe(before, "both kept balances as they were: last seen 45.20, last notified 49.00"));
  }

  /// <summary>
  /// Both balances kept at 45.20; the bank's read fails. The check keeps nothing new, both balances stay exactly as they
  /// were, and its result is the read's failure, as it is (D11: answered as the balance does). Its one line of what it came
  /// to is <c>CheckEnded</c> at Information whose one value is <see cref="CheckEnd.BankReadFailed"/> (D15), with no amount in
  /// any line, in any form, and no time read.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_failed_read_keeps_nothing_new_and_is_the_reads_failure_logged_BankReadFailed(string failure) {
    BankResult<Balance> answer = Failure(failure);
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 45.20m, lastNotified: 45.20m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    CapturedLog log = new();

    BankResult<CheckOutcome> result = await (await CheckWith(answer, store, new StubPushDelivery(), log)).Run(_phone, _noCheckWaits, CancellationToken.None);

    IReadOnlyList<LogEntry> lines = log.Entries;
    LogEntry ended = lines.Where(static line => line.EventName == "CheckEnded").ShouldHaveSingleItem("the check's line of what it came to: one");
    string[] privateForms = [
      "45.2", "45,2", // the kept balance, 45.20
      "1098", "1 098", "1\u00A0098", // its koruna value at 24.3, 1 098.36
      "2026-11-21", "11/21/2026", "21.11.2026", "8:14:03", // the time it was read
    ];
    CheckedBalances? after = await store.Read(CancellationToken.None);
    result.ShouldSatisfyAllConditions(
      () => result.Value.ShouldBe(answer.Value, "the read's failure, as it is"),
      () => after.ShouldBe(before, "nothing new kept: both balances as they were"),
      () => ended.Level.ShouldBe(LogLevel.Information),
      () => ended.OwnValues().Select(static value => value.Value).ShouldBe([CheckEnd.BankReadFailed], "what the check came to: the bank read failed"),
      () => lines.Where(line => privateForms.Any(form => line.AllText().Contains(form, StringComparison.OrdinalIgnoreCase)))
        .ShouldBeEmpty("no line holds the balance, in any form, or a time read"));
  }

  /// <summary>
  /// Both balances kept at 45.20, so they do not differ: a check whose read fails has nothing to notify, and nothing reaches
  /// Lucie's registered phone. A failed read with a change kept is tasks.md group 33's.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_failed_read_with_nothing_to_notify_sends_nothing(string failure) {
    StubPushDelivery delivery = new();

    await (await CheckWith(Failure(failure), await StoreKeeping(lastSeen: 45.20m, lastNotified: 45.20m), delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    delivery.HandedOver.ShouldBeEmpty("nothing is sent");
  }

  /// <summary>
  /// An earlier check kept last seen at 45.20 and left last notified at 49.00, no notification having gone out for it (D10
  /// item 4: a stop between storing and notifying, or a change left to a check that then failed); now the bank's read
  /// fails. The change is notified from the stored balances, last seen as kept: one push, "Odešlo 3,80 €" over
  /// "Zůstatek 45,20 € (≈ 1 098 Kč)"; last notified becomes last seen, whole; and the check's result is still the read's
  /// failure (D11: answered as the balance does, also when it then sent what an earlier check kept). Its one line of what it
  /// came to is <c>CheckEnded</c> with <see cref="CheckEnd.BankReadFailed"/>, as the check answers; the notification shows in
  /// the notifier's <c>ChangeSent</c> line.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_check_whose_read_fails_notifies_a_change_an_earlier_check_kept_from_last_seen_and_still_answers_the_reads_failure(string failure) {
    BankResult<Balance> answer = Failure(failure);
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 45.20m, lastNotified: 49.00m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    StubPushDelivery delivery = new();
    CapturedLog log = new();

    BankResult<CheckOutcome> result = await (await CheckWith(answer, store, delivery, log)).Run(_phone, _noCheckWaits, CancellationToken.None);

    CheckedBalances? after = await store.Read(CancellationToken.None);
    IReadOnlyList<LogEntry> lines = log.Entries;
    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.Select(static handedOver => Notification(handedOver.Push))
        .ShouldBe([("Odešlo 3,80\u00A0€", "Zůstatek 45,20\u00A0€ (≈\u00A01\u00A0098\u00A0Kč)")], "one push, the change from 49.00 to the kept 45.20"),
      () => after.ShouldBe(before with { LastNotified = before.LastSeen }, "last notified becomes last seen, whole"),
      () => result.Value.ShouldBe(answer.Value, "the read's failure, as it is"),
      () => lines.Where(static line => line.EventName == "CheckEnded").Select(static line => line.OwnValues().Single().Value)
        .ShouldBe([CheckEnd.BankReadFailed], "one line of what the check came to: the bank read failed, as the check answers"),
      () => lines.Count(static line => line.EventName == "ChangeSent").ShouldBe(1, "the notification, in the notifier's line"));
  }

  /// <summary>
  /// Nothing kept, and the bank's read fails: there is nothing to notify from, and nothing reaches Lucie's registered phone.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_check_whose_read_fails_with_nothing_kept_sends_nothing(string failure) {
    StubPushDelivery delivery = new();

    await (await CheckWith(Failure(failure), new InMemoryCheckedBalanceStore(), delivery)).Run(_phone, _noCheckWaits, CancellationToken.None);

    delivery.HandedOver.ShouldBeEmpty("nothing is sent");
  }

  /// <summary>
  /// Another check waits behind this one (D10 item 3): a change, found by this check's read or kept from an earlier one, is
  /// left to it. The read is kept as last seen (the store step runs first), last notified is left as it was, nothing is
  /// sent, the one line of what the check came to is <c>CheckEnded</c> with
  /// <see cref="CheckEnd.ChangeLeftToTheNextCheck"/>, and the check answers that the balance changed, since last seen
  /// differs from last notified after its read and store (D11).
  /// </summary>
  /// <param name="keptLastSeen">Last seen as kept before the check, in euros.</param>
  /// <param name="keptLastNotified">Last notified as kept before the check, in euros.</param>
  [Test]
  [Arguments("49.00", "49.00")] // the change is this check's read: 45.20 against 49.00
  [Arguments("45.20", "49.00")] // the change was kept by an earlier check, and the read finds the same balance
  public async Task A_check_with_another_waiting_behind_it_leaves_the_notification_to_it(string keptLastSeen, string keptLastNotified) {
    InMemoryCheckedBalanceStore store = await StoreKeeping(Euros(keptLastSeen), Euros(keptLastNotified));
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    StubPushDelivery delivery = new();
    CapturedLog log = new();

    BankResult<CheckOutcome> result = await (await CheckWith(new Balance(45.20m, "EUR"), store, delivery, log)).Run(_phone, _anotherCheckWaits, CancellationToken.None);

    CheckedBalances? after = await store.Read(CancellationToken.None);
    IReadOnlyList<LogEntry> lines = log.Entries;
    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.ShouldBeEmpty("nothing is sent: the notification is left to the check waiting behind"),
      () => after.ShouldBe(new CheckedBalances(LastSeen: new AccountBalance(45.20m, _now, CZK_PER_EUR), LastNotified: before.LastNotified), "the read kept as last seen; last notified as it was"),
      () => lines.Where(static line => line.EventName == "CheckEnded").Select(static line => line.OwnValues().Single().Value)
        .ShouldBe([CheckEnd.ChangeLeftToTheNextCheck], "one line of what the check came to: the change left to the next check"),
      () => result.Value.ShouldBe(new CheckOutcome(Changed: true), "the balance changed: last seen differs from last notified"));
  }

  /// <summary>
  /// An earlier check kept last seen at 45.20 and last notified at 49.00; this check's read fails, and another check waits
  /// behind it (D10 items 3 and 4): the kept change is left to that one too. Nothing new is kept, last notified is left as
  /// it was, nothing is sent, and the result is still the read's failure (D11). Its one line of what it came to is
  /// <c>CheckEnded</c> with <see cref="CheckEnd.BankReadFailed"/>, as the check answers, as for a failed read that notified
  /// (tasks.md 33.1); no <c>ChangeSent</c> line, since nothing was sent.
  /// </summary>
  /// <param name="failure">The bank's expected failures (C13).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_check_whose_read_fails_with_another_waiting_behind_it_leaves_a_kept_change_to_it(string failure) {
    BankResult<Balance> answer = Failure(failure);
    InMemoryCheckedBalanceStore store = await StoreKeeping(lastSeen: 45.20m, lastNotified: 49.00m);
    CheckedBalances before = (await store.Read(CancellationToken.None)).ShouldNotBeNull();
    StubPushDelivery delivery = new();
    CapturedLog log = new();

    BankResult<CheckOutcome> result = await (await CheckWith(answer, store, delivery, log)).Run(_phone, _anotherCheckWaits, CancellationToken.None);

    CheckedBalances? after = await store.Read(CancellationToken.None);
    IReadOnlyList<LogEntry> lines = log.Entries;
    result.ShouldSatisfyAllConditions(
      () => delivery.HandedOver.ShouldBeEmpty("nothing is sent: the kept change is left to the check waiting behind"),
      () => after.ShouldBe(before, "nothing new kept; last notified as it was"),
      () => result.Value.ShouldBe(answer.Value, "the read's failure, as it is"),
      () => lines.Where(static line => line.EventName == "CheckEnded").Select(static line => line.OwnValues().Single().Value)
        .ShouldBe([CheckEnd.BankReadFailed], "one line of what the check came to: the bank read failed, as the check answers"),
      () => lines.ShouldNotContain(static line => line.EventName == "ChangeSent", "nothing was sent"));
  }

  /// <summary>An amount in euros given as invariant text (an attribute cannot hold a decimal).</summary>
  private static decimal Euros(string amount) => decimal.Parse(amount, NumberStyles.Number, CultureInfo.InvariantCulture);

  /// <summary>The bank's expected failure named <paramref name="failure"/>: access expired, rate limited or unavailable.</summary>
  private static BankResult<Balance> Failure(string failure) => failure switch {
    "access expired" => new BankAccessExpired(),
    "rate limited" => new BankRateLimited(),
    "unavailable" => new BankUnavailable(),
    _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
  };

  /// <summary>A store of the check's balances that keeps <paramref name="lastSeen"/> and <paramref name="lastNotified"/> EUR, both read an hour before <see cref="_now"/> at <see cref="CZK_PER_EUR"/>.</summary>
  private static async Task<InMemoryCheckedBalanceStore> StoreKeeping(decimal lastSeen, decimal lastNotified) {
    InMemoryCheckedBalanceStore store = new();
    DateTimeOffset earlier = _now.AddHours(-1);

    await store.Save(
      new CheckedBalances(
        LastSeen: new AccountBalance(lastSeen, earlier, CZK_PER_EUR),
        LastNotified: new AccountBalance(lastNotified, earlier, CZK_PER_EUR)),
      CancellationToken.None);

    return store;
  }

  /// <summary>
  /// The notification a push carries, as its Declarative Web Push JSON holds it (<c>notification.title</c> and
  /// <c>notification.body</c>); whatever else the push carries is not read here.
  /// </summary>
  private static (string? Title, string? Text) Notification(OutgoingPush push) {
    using JsonDocument message = JsonDocument.Parse(push.Content);
    JsonElement notification = message.RootElement.GetProperty("notification");

    return (Text(notification, "title"), Text(notification, "body"));

    static string? Text(JsonElement value, string name) =>
      value.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.String ? member.GetString() : null;
  }

  /// <summary>The check under test, as the other overload, with a bank that answers every balance read with <paramref name="bankAnswer"/>.</summary>
  private static Task<AccountCheck> CheckWith(BankResult<Balance> bankAnswer, ICheckedBalanceStore store, IPushDelivery delivery, CapturedLog? log = null) =>
    CheckWith(new StubBankAccount(bankAnswer), store, delivery, log);

  /// <summary>
  /// The check under test: it reads the balance at <paramref name="bank"/> while the clock shows <see cref="_now"/>; its
  /// balances are kept in <paramref name="store"/>; it notifies through a real notifier and sender, with the allowlist Lucie
  /// and Petr, to <paramref name="delivery"/>; the sender's device store is <paramref name="devices"/>, or one holding Lucie's
  /// phone (<see cref="DevicesWithLuciesPhone"/>); every log line goes to <paramref name="log"/>.
  /// </summary>
  private static async Task<AccountCheck> CheckWith(StubBankAccount bank, ICheckedBalanceStore store, IPushDelivery delivery, CapturedLog? log = null, IPushDeviceStore? devices = null) {
    CapturedLog lines = log ?? new CapturedLog();
    Allowlist allowlist = Allowlist.Parse($"{LUCIE}, {PETR}");
    IPushDeviceStore deviceStore = devices ?? await DevicesWithLuciesPhone();

    SendPushHandler sender = new(deviceStore, delivery, allowlist, Options.Create(new PushOptions {
      VapidPublicKey = NOT_READ_WHEN_SENDING,
      VapidPrivateKey = NOT_READ_WHEN_SENDING,
      MessageKey = NOT_READ_WHEN_SENDING,
      Subject = new Uri(APP_ADDRESS),
      Services = new Dictionary<string, string>(StringComparer.Ordinal) { ["Google"] = "https://fcm.googleapis.com" },
    }), lines.For<SendPushHandler>());

    return new AccountCheck(
      new ReadBalanceHandler(bank, new FixedKorunaRates(new(CZK_PER_EUR, new DateOnly(2026, 11, 20))), new FakeTimeProvider(_now)),
      store,
      new ChangeNotifier(allowlist, sender, lines.For<ChangeNotifier>()),
      lines.For<AccountCheck>());
  }

  /// <summary>C8a's in-memory device store, holding Lucie's registered phone.</summary>
  private static async Task<InMemoryPushDeviceStore> DevicesWithLuciesPhone() {
    InMemoryPushDeviceStore devices = new();
    await devices.Save(_luciesPhone, CancellationToken.None);

    return devices;
  }

  /// <summary>A device of <paramref name="account"/> at a made-up push address, with keys as a browser makes them (random here: the stub never decrypts).</summary>
  private static PushDevice Device(string account) {
    byte[] point = RandomNumberGenerator.GetBytes(65);
    point[0] = 0x04;

    return new PushDevice(
      $"https://fcm.googleapis.com/fcm/send/made-up-{Guid.NewGuid():N}",
      Base64Url.EncodeToString(point),
      Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
      account);
  }

  /// <summary>
  /// The sender's device table, which cannot be read (<see cref="ReadAll"/> throws <see cref="Failure"/>, as a storage
  /// failure would) until the test makes it <see cref="Readable"/>; then it is <paramref name="devices"/>.
  /// </summary>
  private sealed class FailingDeviceTable(IPushDeviceStore devices) : IPushDeviceStore {
    /// <summary>The failure every read throws while the table cannot be read; made up.</summary>
    public InvalidOperationException Failure { get; } = new("A made-up storage failure: the device table cannot be read.");

    /// <summary>Whether the table can be read; not at first.</summary>
    public bool Readable { get; set; }

    public Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken) =>
      Readable ? devices.ReadAll(cancellationToken) : throw Failure;

    public Task Save(PushDevice device, CancellationToken cancellationToken) => devices.Save(device, cancellationToken);

    public Task Forget(string endpoint, CancellationToken cancellationToken) => devices.Forget(endpoint, cancellationToken);
  }

  /// <summary>
  /// The bank port, answering every balance read with <paramref name="answer"/> and recording who each read was for
  /// (<see cref="ReadsFor"/>); a check reads no transactions (D3).
  /// </summary>
  private sealed class StubBankAccount(BankResult<Balance> answer) : IBankAccount {
    private readonly Lock _lock = new();
    private readonly List<object> _readsFor = [];

    /// <summary>Who each balance read was for, in order: the trigger's case (a <see cref="PresentUser"/> or <see cref="Unattended"/>).</summary>
    public IReadOnlyList<object> ReadsFor {
      get {
        lock (_lock)
          return [.. _readsFor];
      }
    }

    public Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) {
      lock (_lock)
        _readsFor.Add(trigger.Value!);

      return Task.FromResult(answer);
    }

    public Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) =>
      throw new NotSupportedException("A check reads no transactions.");
  }

  /// <summary>
  /// One log for every logger of a check (the check's, the notifier's, the sender's): each line with its category, level,
  /// event name, structured values and message. A source-generated line's values are its own fields and its template.
  /// </summary>
  private sealed class CapturedLog {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>Every line, in the order written.</summary>
    public IReadOnlyList<LogEntry> Entries {
      get {
        lock (_lock)
          return [.. _entries];
      }
    }

    /// <summary>A logger of category <typeparamref name="T"/> writing into this log.</summary>
    public ILogger<T> For<T>() => new CategoryLogger<T>(this);

    private void Add(LogEntry entry) {
      lock (_lock)
        _entries.Add(entry);
    }

    private sealed class CategoryLogger<T>(CapturedLog log) : ILogger<T> {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
        ArgumentNullException.ThrowIfNull(formatter);

        IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
        log.Add(new LogEntry(typeof(T).Name, logLevel, eventId.Name, [.. values], formatter(state, exception)));
      }
    }
  }

  /// <summary>One line of a check's log.</summary>
  private sealed record LogEntry(string Category, LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values, string Message) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>The line's own fields, without its message template, as the logging source generator enumerates them.</summary>
    public IReadOnlyList<KeyValuePair<string, object?>> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT)];

    /// <summary>The line's own fields as <c>name=value</c>, without its message template, in the order the generator enumerates them.</summary>
    public IReadOnlyList<string> OwnNamedValues() => [.. OwnValues().Select(static pair => $"{pair.Key}={pair.Value}")];

    /// <summary>The category, the event's name, the message and every value, as one text.</summary>
    public string AllText() => string.Join(" | ", [Category, EventName, Message, .. Values.Select(static pair => $"{pair.Key}={pair.Value}")]);

    #region Object overrides

    /// <summary>For a failure message: the category, the level and the event.</summary>
    public override string ToString() => $"{Category} {Level} {EventName}";

    #endregion
  }
}