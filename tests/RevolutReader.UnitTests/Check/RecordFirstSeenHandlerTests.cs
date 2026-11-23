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
/// unattended (ADR-0008 item 3).
/// <para>
/// The bank is <see cref="StubCheckBank"/>, answering no transaction; the first-seen moments
/// <see cref="InMemoryFirstSeenStore"/> through a real <see cref="FirstSeenTimes"/>; the clock a
/// <see cref="FakeTimeProvider"/>. The address is a documentation address (RFC 5737), the browser name the Shortcut's.
/// </para>
/// </summary>
public sealed class RecordFirstSeenHandlerTests {
  /// <summary>The clock: 2026-11-20 13:05:12 UTC, the spec's check.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

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

  /// <summary>The recorder under test: it reads <paramref name="bank"/> while the clock shows <see cref="_now"/>, and records into an empty first-seen store.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank) =>
    new(bank, new FirstSeenTimes(new InMemoryFirstSeenStore()), new FakeTimeProvider(_now), NullLogger<RecordFirstSeenHandler>.Instance);
}