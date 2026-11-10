using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// An app copy for the message endpoint's own tests (c011 design.md D10), in environment <c>Production</c> on the shared
/// <see cref="MadeUpSettings"/>, added last so they win, with a message key of its own and
/// <see cref="ALLOWED_ACCOUNT"/> as the allowlist. The storage connection is Azurite's shorthand, never reached: it goes
/// in as a host setting, which the factory hands to the app's builder before Program.cs registers the stores, and these
/// tests send only requests the endpoint answers before it reads a table. Requests as PowerShell sends them: no fetch
/// metadata, no <c>Origin</c>, so the rule against writes from other sites lets them through (c007 design.md D4).
/// </summary>
internal sealed class MessageEndpointApp : WebApplicationFactory<Program> {
  /// <summary>The message endpoint and its key's header (D10).</summary>
  public const string MESSAGES = "/api/push/messages";
  public const string MESSAGE_KEY_HEADER = "X-Message-Key";

  /// <summary>The one account on this app copy's allowlist, made up.</summary>
  public const string ALLOWED_ACCOUNT = "lucie@example.com";

  private const string TABLES_CONNECTION = "ConnectionStrings:tables";
  private const string MADE_UP_TABLES_CONNECTION = "UseDevelopmentStorage=true";

  /// <summary>This app copy's message key, made up.</summary>
  public string MessageKey { get; } = MadeUpSettings.MessageKey();

  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    builder.UseEnvironment(Environments.Production);
    builder.UseSetting(TABLES_CONNECTION, MADE_UP_TABLES_CONNECTION);
    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(MadeUpSettings.For(ALLOWED_ACCOUNT, MessageKey)));
  }
}