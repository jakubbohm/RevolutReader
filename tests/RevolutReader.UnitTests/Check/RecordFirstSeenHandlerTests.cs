using System.Globalization;
using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using RevolutReader.UnitTests.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The account check's recording of first sightings (c018 design.md D5; § Public API sketch,
/// <see cref="RecordFirstSeenHandler"/>): it reads the transactions as the present user the check runs for, never
/// unattended (ADR-0008 item 3), from the UTC day before the clock's today.
/// <para>
/// The bank is <see cref="StubCheckBank"/>, answering no transaction; the first-seen moments
/// <see cref="InMemoryFirstSeenStore"/> through a real <see cref="FirstSeenTimes"/>; the clock a
/// <see cref="FakeTimeProvider"/>. The address is a documentation address (RFC 5737), the browser name the Shortcut's.
/// </para>
/// </summary>
public sealed class RecordFirstSeenHandlerTests {
  /// <summary>The clock: 2026-11-20 13:05:12 UTC, the spec's check.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <summary>The owner's phone, as its Shortcut calls: a documentation address and the Shortcut's browser name.</summary>
  private static readonly PresentUser _phone = new(IPAddress.Parse("203.0.113.7"), "BackgroundShortcutRunner/5114.0");

  /// <summary>
  /// The recorder reads the transactions once, as the user it is given: the bank gets that user's address and browser name
  /// (spec account-check, "The check reads the balance and the recent transactions as the phone present"; D5; tasks.md
  /// 21.1). The user is one no other test here names.
  /// </summary>
  [Test]
  public async Task It_reads_the_transactions_as_the_present_user_it_is_given() {
    PresentUser user = new(IPAddress.Parse("203.0.113.42"), "BackgroundShortcutRunner/5108.1");
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank).Handle(user, CancellationToken.None);

    bank.TransactionReadsFor.ShouldBe([user], "one transactions read, as the user given: the same address and browser name");
  }

  /// <summary>
  /// The check's transactions read starts at the UTC day before the clock's today (D5: "yesterday is the UTC date before
  /// the clock's"; spec account-check, "The check reads the transactions from yesterday on"; tasks.md 24.1). The clock's
  /// offset does not count: at 23:30 UTC on 2026-11-20, given at +01:00, where its own date is already the 21st, the read
  /// still starts on the 19th.
  /// </summary>
  /// <param name="clock">What the clock gives, as round-trip text with its offset.</param>
  /// <param name="from">The day the read must start, <c>yyyy-MM-dd</c>.</param>
  [Test]
  [Arguments("2026-11-20T13:05:12+00:00", "2026-11-19")] // the spec's check, at the clock's offset zero
  [Arguments("2026-11-21T00:30:00+01:00", "2026-11-19")] // 23:30 UTC on 2026-11-20, given at +01:00
  public async Task The_checks_transactions_read_starts_at_the_UTC_day_before_the_clocks_today(string clock, string from) {
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank, new FakeTimeProvider(Instant(clock))).Handle(_phone, CancellationToken.None);

    bank.TransactionReadsFrom.ShouldBe([Day(from)], "one transactions read, from the UTC day before the clock's today");
  }

  /// <summary>
  /// Five seconds after UTC midnight starts 2026-11-21, the read starts at 2026-11-20, the UTC day that has just ended
  /// (D5: the extra day covers a check that straddles midnight; tasks.md 24.2), also when the clock gives that moment at
  /// -08:00, where its own date is still the 20th.
  /// </summary>
  /// <param name="clock">What the clock gives, as round-trip text with its offset.</param>
  [Test]
  [Arguments("2026-11-21T00:00:05+00:00")] // at the clock's offset zero
  [Arguments("2026-11-20T16:00:05-08:00")] // the same moment, given at -08:00
  public async Task Just_after_UTC_midnight_the_read_starts_at_the_day_that_has_just_ended(string clock) {
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank, new FakeTimeProvider(Instant(clock))).Handle(_phone, CancellationToken.None);

    bank.TransactionReadsFrom.ShouldBe([new DateOnly(2026, 11, 20)], "one transactions read, from the UTC day that has just ended");
  }

  /// <summary>An instant written as round-trip text, its offset kept as written.</summary>
  private static DateTimeOffset Instant(string text) => DateTimeOffset.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

  /// <summary>A day written <c>yyyy-MM-dd</c>.</summary>
  private static DateOnly Day(string text) => DateOnly.ParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture);

  /// <summary>The recorder under test, as the other overload, while the clock shows <see cref="_now"/>.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank) => Recorder(bank, new FakeTimeProvider(_now));

  /// <summary>The recorder under test: it reads <paramref name="bank"/> on <paramref name="clock"/>, and records into an empty first-seen store.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank, TimeProvider clock) =>
    new(bank, new FirstSeenTimes(new InMemoryFirstSeenStore()), clock, NullLogger<RecordFirstSeenHandler>.Instance);
}