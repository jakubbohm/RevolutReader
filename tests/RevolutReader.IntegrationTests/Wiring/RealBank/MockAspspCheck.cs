using System.Net;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.RealBank;

/// <summary>
/// Check 1 (c004 design.md D7): the bank port on its production wiring (<see cref="EnableBankingRegistration.AddEnableBanking"/>)
/// against Enable Banking's real API and its Mock ASPSP, through the sandbox application, with the settings
/// <c>aspire start</c> uses: the AppHost's user-secrets. It proves what the fake bank cannot: the signed token, the
/// addresses, the headers, the real JSON.
/// <list type="bullet">
/// <item>The balance and the transactions (from 89 days back; one page, as the mock did not page at 25) each read once for
/// a present user and once unattended.</item>
/// <item>A made-up account id is a misconfiguration (design.md § Ports and contracts): the mock answers 404
/// <c>ACCOUNT_DOES_NOT_EXIST</c>, so the read throws. Corrected from D7's made-up session id (the orchestrator,
/// 2026-11-07): a read never sends the session id, only the account id is in its path.</item>
/// </list>
/// Explicit: <c>dotnet test</c> and CI never run it; the owner does, on the owner's machine. It prints outcomes and counts
/// only, never amounts, names, texts or ids, though the mock's data is made up.
/// </summary>
[Explicit]
[Category("RealBank")]
public sealed class MockAspspCheck {
  /// <summary>Each setting of the section and the AppHost user-secret it comes from (the AppHost's parameters).</summary>
  private static readonly (string Setting, string UserSecret)[] _secrets = [
    ("ApplicationId", "Parameters:enablebanking-application-id"),
    ("PrivateKey", "Parameters:enablebanking-private-key"),
    ("SessionId", "Parameters:enablebanking-session-id"),
    ("AccountId", "Parameters:enablebanking-account-id"),
  ];

  /// <summary>A documentation address (RFC 5737) and a made-up browser: the mock checks the header's form, not the person.</summary>
  private static readonly PresentUser _presentUser = new(IPAddress.Parse("203.0.113.7"), "Mozilla/5.0 (RevolutReader Check 1; made up)");

  [Test]
  public async Task The_balance_reads_for_a_present_user_and_unattended() {
    await using ServiceProvider services = RealBankWiring.Wiring(RealBankWiring.SettingsFromUserSecrets(_secrets));
    IBankAccount account = services.GetRequiredService<IBankAccount>();

    foreach ((string who, ReadTrigger trigger) in Triggers()) {
      BankResult<Balance> result = await account.ReadBalance(trigger, CancellationToken.None);

      Console.WriteLine($"Balance, {who}: {RealBankWiring.OutcomeOf(result.Value)}");
      result.Value.ShouldBeOfType<Balance>($"the balance read for {who}");
    }
  }

  [Test]
  public async Task The_transactions_of_the_last_89_days_read_for_a_present_user_and_unattended() {
    await using ServiceProvider services = RealBankWiring.Wiring(RealBankWiring.SettingsFromUserSecrets(_secrets));
    IBankAccount account = services.GetRequiredService<IBankAccount>();
    DateOnly from = DateOnly.FromDateTime(TimeProvider.System.GetUtcNow().UtcDateTime).AddDays(-89);

    foreach ((string who, ReadTrigger trigger) in Triggers()) {
      BankResult<Transactions> result = await account.ReadTransactions(from, trigger, CancellationToken.None);

      Console.WriteLine($"Transactions of the last 89 days, {who}: {RealBankWiring.OutcomeOf(result.Value)}{CountsOf(result.Value)}");
      result.Value.ShouldBeOfType<Transactions>($"the transactions read for {who}");
    }
  }

  [Test]
  public async Task An_unknown_account_is_an_error_naming_404_and_ACCOUNT_DOES_NOT_EXIST() {
    Dictionary<string, string?> settings = RealBankWiring.SettingsFromUserSecrets(_secrets);
    settings[RealBankWiring.Key("AccountId")] = Guid.NewGuid().ToString();
    await using ServiceProvider services = RealBankWiring.Wiring(settings);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => services.GetRequiredService<IBankAccount>().ReadBalance(_presentUser, CancellationToken.None));

    // The message names the status and the error code only (D5).
    Console.WriteLine($"Balance of a made-up account: {nameof(BankReadException)}, {error.Message}");
    error.Message.ShouldBe(new BankReadException(HttpStatusCode.NotFound, "ACCOUNT_DOES_NOT_EXIST").Message);
  }

  /// <summary>Who triggers each read: a present user, then nobody.</summary>
  private static IEnumerable<(string Who, ReadTrigger Trigger)> Triggers() => [("a present user", _presentUser), ("unattended", new Unattended())];

  /// <summary>How many transactions came back, by status; nothing else about them.</summary>
  private static string CountsOf(object? value) => value is Transactions transactions
    ? $", {transactions.Items.Count} transactions ({transactions.Items.Count(static item => item.Status == TransactionStatus.Booked)} booked, {transactions.Items.Count(static item => item.Status == TransactionStatus.Pending)} pending)"
    : string.Empty;
}