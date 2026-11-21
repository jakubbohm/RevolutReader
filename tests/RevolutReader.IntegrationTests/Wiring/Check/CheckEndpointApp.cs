using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace RevolutReader.IntegrationTests.Wiring.Check;

/// <summary>
/// An app copy for the check endpoint's own tests (c014 design.md D6), in environment <c>Production</c> on the shared
/// <see cref="MadeUpSettings"/>, added last so they win, with a check key and a message key of its own. The storage
/// connection is Azurite's shorthand, never reached: it goes in as a host setting, which the factory hands to the app's
/// builder before Program.cs registers the stores, and these tests send only requests the endpoint answers before it reads
/// a table. The bank's address is a loopback port nothing listens on, so not even a broken endpoint could reach
/// <c>appsettings.json</c>'s real Enable Banking address with the made-up ids. Requests as the iPhone Shortcut sends them:
/// no fetch metadata, no <c>Origin</c>, so the rule against writes from other sites lets them through (c007 design.md D4).
/// </summary>
internal sealed class CheckEndpointApp : WebApplicationFactory<Program> {
  /// <summary>The check endpoint and its key's header (D6).</summary>
  public const string CHECK = "/api/account/check";
  public const string CHECK_KEY_HEADER = "X-Check-Key";

  /// <summary>The one account on this app copy's allowlist, made up.</summary>
  private const string ALLOWED_ACCOUNT = "lucie@example.com";

  private const string TABLES_CONNECTION = "ConnectionStrings:tables";
  private const string MADE_UP_TABLES_CONNECTION = "UseDevelopmentStorage=true";

  /// <summary>The check key's setting (D6) and its size: 32 random bytes, as the owner's block makes one.</summary>
  private const string CHECK_KEY_SETTING = "AccountCheck:Key";
  private const int CHECK_KEY_BYTES = 32;

  /// <summary>The bank's address: plain http on a loopback port nothing listens on (the discard port), which the bank settings allow for this machine.</summary>
  private const string BANK_ADDRESS_SETTING = "EnableBanking:ApiBaseUrl";
  private const string UNREACHED_BANK_ADDRESS = "http://127.0.0.1:9/";

  /// <summary>This app copy's check key, made up.</summary>
  public string CheckKey { get; } = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(CHECK_KEY_BYTES));

  /// <summary>This app copy's message key, made up: never the check key (D6, a key of its own).</summary>
  public string MessageKey { get; } = MadeUpSettings.MessageKey();

  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    Dictionary<string, string?> settings = MadeUpSettings.For(ALLOWED_ACCOUNT, MessageKey);
    settings[CHECK_KEY_SETTING] = CheckKey;
    settings[BANK_ADDRESS_SETTING] = UNREACHED_BANK_ADDRESS;

    builder.UseEnvironment(Environments.Production);
    builder.UseSetting(TABLES_CONNECTION, MADE_UP_TABLES_CONNECTION);
    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }
}