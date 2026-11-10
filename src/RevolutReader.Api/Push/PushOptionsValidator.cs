using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>
/// What the data annotations cannot check (c011 design.md D5): the VAPID public key is a P-256 point and the private key a
/// 32-byte scalar, each in base64url without padding, and a fixed text signed with the private half verifies with the
/// public half (an import alone does not prove they belong together); the message key is at least 32 bytes in base64url;
/// Subject is an https origin; every entry of Services is a push service pattern (D9: <see cref="PushServicePattern"/>, the
/// rule <see cref="KnownPushServices"/> matches by). The request timeout's range is a data annotation. Each message names
/// the setting (and the entry), never its value or any part of it.
/// </summary>
public sealed class PushOptionsValidator : IValidateOptions<PushOptions> {
  private const int MESSAGE_KEY_MIN_BYTES = 32;

  private const string NOT_A_PUBLIC_KEY =
    $"{nameof(PushOptions)}.{nameof(PushOptions.VapidPublicKey)} is not a VAPID public key: "
    + "expected the 65-byte uncompressed P-256 point (0x04, X, Y) in base64url without padding.";

  private const string NOT_A_PRIVATE_KEY =
    $"{nameof(PushOptions)}.{nameof(PushOptions.VapidPrivateKey)} is not a VAPID private key: "
    + "expected the 32-byte P-256 scalar in base64url without padding.";

  private const string NOT_ONE_PAIR =
    $"{nameof(PushOptions)}.{nameof(PushOptions.VapidPublicKey)} and {nameof(PushOptions)}.{nameof(PushOptions.VapidPrivateKey)} "
    + "are not one key pair: a text signed with the private key does not verify with the public key. Generate the two together.";

  private const string NOT_A_MESSAGE_KEY =
    $"{nameof(PushOptions)}.{nameof(PushOptions.MessageKey)} is not a message key: "
    + "expected at least 32 random bytes in base64url without padding.";

  private const string NOT_AN_APP_ADDRESS =
    $"{nameof(PushOptions)}.{nameof(PushOptions.Subject)} is not the app's address: "
    + "expected an absolute https address with no path beyond \"/\", and no query or fragment.";

  /// <summary>What the private half signs and the public half must verify.</summary>
  private static ReadOnlySpan<byte> PairCheckText => "RevolutReader push settings: one VAPID key pair"u8;

  public ValidateOptionsResult Validate(string? name, PushOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    List<string> failures = [];

    using ECDsa? publicKey = P256Keys.ImportPublicKey(options.VapidPublicKey);
    using ECDsa? privateKey = P256Keys.ImportPrivateKey(options.VapidPrivateKey);

    if (publicKey is null)
      failures.Add(NOT_A_PUBLIC_KEY);

    if (privateKey is null)
      failures.Add(NOT_A_PRIVATE_KEY);

    if (publicKey is not null && privateKey is not null && !AreOnePair(publicKey, privateKey))
      failures.Add(NOT_ONE_PAIR);

    if (StrictBase64Url.Decode(options.MessageKey) is not { Length: >= MESSAGE_KEY_MIN_BYTES })
      failures.Add(NOT_A_MESSAGE_KEY);

    if (!IsAppAddress(options.Subject))
      failures.Add(NOT_AN_APP_ADDRESS);

    if (options.Services is not null)
      failures.AddRange(options.Services
        .Where(static entry => !PushServicePattern.TryParse(entry.Value, out _))
        .Select(static entry => NotAPushService(entry.Key)));

    return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
  }

  private static bool AreOnePair(ECDsa publicKey, ECDsa privateKey) {
    try {
      byte[] signature = privateKey.SignData(PairCheckText, HashAlgorithmName.SHA256);

      return publicKey.VerifyData(PairCheckText, signature, HashAlgorithmName.SHA256);
    }
    catch (CryptographicException) {
      return false; // a scalar the platform took but cannot sign with (e.g. zero, on Linux)
    }
  }

  /// <summary>
  /// Whether <paramref name="address"/> is an absolute https address with no path beyond "/", no query and no fragment:
  /// the token's contact, and the base every page a tap opens is resolved against (D2, D5). Unlike the push services, no
  /// plain http on this machine: the app's own address is https everywhere (D9). A scheme-less value binds as a relative
  /// address.
  /// </summary>
  private static bool IsAppAddress(Uri? address) =>
    address is { IsAbsoluteUri: true }
    && address.Scheme == Uri.UriSchemeHttps
    && address.AbsolutePath == "/"
    && address.Query.Length == 0
    && address.Fragment.Length == 0;

  /// <summary>The failure for the entry <paramref name="entry"/> of Services: its name, never its value.</summary>
  private static string NotAPushService(string entry) =>
    $"{nameof(PushOptions)}.{nameof(PushOptions.Services)}:{entry} is not a push service pattern: expected https and a host, "
    + "or https, \"*.\" and a host suffix, with an optional port and no user information, path, query or fragment; plain http "
    + "only on a loopback host.";
}