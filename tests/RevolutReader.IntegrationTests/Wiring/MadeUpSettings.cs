using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;

namespace RevolutReader.IntegrationTests.Wiring;

/// <summary>
/// Made up, never real: a value for each secret the app checks at start, so an app copy in environment <c>Production</c>
/// starts on <c>appsettings.json</c> without its <c>"&lt;secret&gt;"</c> placeholders. The keys are generated per call,
/// never printed. Every app copy of the wiring tests that runs on made-up settings builds them here: the OpenAPI export
/// (<c>OpenApiExport</c>), <c>MessageEndpointApp</c> and <c>SubscriptionEndpointApp</c>. A change that adds a setting
/// checked at start adds a made-up value to <see cref="For"/>.
/// </summary>
internal static class MadeUpSettings {
  /// <summary>An uncompressed elliptic-curve point's first byte (SEC 1, § 2.3.3).</summary>
  private const byte UNCOMPRESSED_POINT = 0x04;

  /// <summary>The message key's size (c011 design.md D5).</summary>
  private const int MESSAGE_KEY_BYTES = 32;

  /// <summary>A made-up message key, as the owner's block makes one: 32 random bytes in base64url.</summary>
  public static string MessageKey() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(MESSAGE_KEY_BYTES));

  /// <summary>
  /// The made-up settings, with <paramref name="allowedEmails"/> as the allowlist and <paramref name="messageKey"/> as the
  /// message key, or one made up here when none is given.
  /// </summary>
  public static Dictionary<string, string?> For(string allowedEmails, string? messageKey = null) {
    ArgumentException.ThrowIfNullOrWhiteSpace(allowedEmails);

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
      // The sign-in's authority and client id are appsettings.json's own values, not secrets (c007 design.md D11).
      ["SignIn:ClientSecret"] = $"made-up-client-secret-{Guid.NewGuid()}",
      ["SignIn:AllowedEmails"] = allowedEmails,
      // The push settings' forms (c011 design.md D5), base64url without padding: the VAPID public key the uncompressed
      // point (0x04, X, Y), its private half the scalar, the message key 32 random bytes. Subject and the known push
      // services are appsettings.json's own values.
      ["Push:VapidPublicKey"] = Base64Url.EncodeToString([UNCOMPRESSED_POINT, .. x, .. y]),
      ["Push:VapidPrivateKey"] = Base64Url.EncodeToString(d),
      ["Push:MessageKey"] = messageKey ?? MessageKey(),
    };
  }
}