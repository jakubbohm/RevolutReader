using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// An app copy for the message endpoint's own tests (c011 design.md D10), in environment <c>Production</c> on made-up
/// settings (as <c>OpenApiExport</c>'s), added last so they win, with a message key of its own and
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

  /// <summary>An uncompressed elliptic-curve point's first byte (SEC 1, § 2.3.3).</summary>
  private const byte UNCOMPRESSED_POINT = 0x04;

  /// <summary>The message key's size (D5).</summary>
  private const int MESSAGE_KEY_BYTES = 32;

  /// <summary>This app copy's message key, made up.</summary>
  public string MessageKey { get; } = MadeUpMessageKey();

  /// <summary>A made-up message key, as the owner's block makes one: 32 random bytes in base64url.</summary>
  public static string MadeUpMessageKey() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(MESSAGE_KEY_BYTES));

  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    builder.UseEnvironment(Environments.Production);
    builder.UseSetting(TABLES_CONNECTION, MADE_UP_TABLES_CONNECTION);
    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(MadeUpSettings(MessageKey)));
  }

  /// <summary>
  /// Made up, never real: each secret the app checks at start, the keys generated per app copy, with
  /// <paramref name="messageKey"/> as the message key and <see cref="ALLOWED_ACCOUNT"/> as the allowlist. Shared with
  /// <see cref="SubscriptionEndpointApp"/>.
  /// </summary>
  public static Dictionary<string, string?> MadeUpSettings(string messageKey) {
    using RSA key = RSA.Create(2048);
    using ECDsa vapidKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    ECParameters vapid = vapidKey.ExportParameters(includePrivateParameters: true);
    byte[] x = vapid.Q.X ?? throw new UnreachableException("An exported P-256 key has its point.");
    byte[] y = vapid.Q.Y ?? throw new UnreachableException("An exported P-256 key has its point.");
    byte[] d = vapid.D ?? throw new UnreachableException("A key exported with its private parameters has its scalar.");

    return new() {
      ["EnableBanking:ApplicationId"] = Guid.NewGuid().ToString(),
      ["EnableBanking:PrivateKey"] = key.ExportPkcs8PrivateKeyPem(),
      ["EnableBanking:SessionId"] = Guid.NewGuid().ToString(),
      ["EnableBanking:AccountId"] = Guid.NewGuid().ToString(),
      ["SignIn:ClientSecret"] = $"made-up-client-secret-{Guid.NewGuid()}",
      ["SignIn:AllowedEmails"] = ALLOWED_ACCOUNT,
      ["Push:VapidPublicKey"] = Base64Url.EncodeToString([UNCOMPRESSED_POINT, .. x, .. y]),
      ["Push:VapidPrivateKey"] = Base64Url.EncodeToString(d),
      ["Push:MessageKey"] = messageKey,
    };
  }
}