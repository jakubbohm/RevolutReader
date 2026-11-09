using System.Diagnostics;

namespace RevolutReader.Api.Push;

/// <summary>
/// Registers a device (spec push-devices, c011 design.md D3, D9, D11): a subscription whose push address lies at a known
/// push service (<see cref="KnownPushServices"/>) and whose keys are well formed (the public key the 65-byte uncompressed
/// P-256 point, the secret 16 bytes, each in base64url without padding) is saved under the signed-in account, replacing
/// whatever was saved under its push address, so the same address registered again moves to the account signed in now.
/// Otherwise it is refused, each refused member named with a fixed reason, never its value, and nothing is stored.
/// Logs nothing of its own (D4).
/// </summary>
public sealed class RegisterDeviceHandler(IPushDeviceStore store, KnownPushServices services) {
  /// <summary>The members a refusal names, as the browser's subscription names them (D9).</summary>
  private const string ENDPOINT = "endpoint";
  private const string P256DH = "keys.p256dh";
  private const string AUTH = "keys.auth";

  private const string NOT_AT_A_KNOWN_SERVICE = "The push address is not at a known push service.";
  private const string MISSING = "Missing.";

  private const string NOT_A_PUBLIC_KEY =
    "Not a device public key: expected the 65-byte uncompressed P-256 point (0x04, X, Y) in base64url without padding.";

  private const string NOT_A_SECRET = "Not a device secret: expected 16 bytes in base64url without padding.";

  /// <summary>The device's public key: the uncompressed P-256 point, 0x04 then X and Y, 32 bytes each (D9; SEC 1, § 2.3.3).</summary>
  private const int POINT_BYTES = 65;

  private const byte UNCOMPRESSED_POINT = 0x04;

  /// <summary>The device's secret (D9; RFC 8291 § 3.2).</summary>
  private const int SECRET_BYTES = 16;

  /// <summary>Saves the device under <paramref name="account"/>, the signed-in account's email, or refuses it, as the class describes.</summary>
  public async Task<RegistrationResult> Handle(DeviceSubscription subscription, string account, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(subscription);
    ArgumentException.ThrowIfNullOrWhiteSpace(account);

    List<RefusedMember> refused = Refusals(subscription);

    if (refused.Count > 0)
      return new SubscriptionRefused(refused);

    if (subscription is not { Endpoint: { } endpoint, P256dh: { } p256dh, Auth: { } auth })
      throw new UnreachableException("A subscription with no refused member has its push address and both keys.");

    await store.Save(new PushDevice(endpoint, p256dh, auth, account), cancellationToken);

    return new Registered();
  }

  /// <summary>Each member of <paramref name="subscription"/> that is refused, with its fixed reason.</summary>
  private List<RefusedMember> Refusals(DeviceSubscription subscription) {
    List<RefusedMember> refused = [];

    if (subscription.Endpoint is null || !services.Accepts(subscription.Endpoint))
      refused.Add(new RefusedMember(ENDPOINT, NOT_AT_A_KNOWN_SERVICE));

    if (subscription.P256dh is null)
      refused.Add(new RefusedMember(P256DH, MISSING));
    else if (!IsPublicKey(subscription.P256dh))
      refused.Add(new RefusedMember(P256DH, NOT_A_PUBLIC_KEY));

    if (subscription.Auth is null)
      refused.Add(new RefusedMember(AUTH, MISSING));
    else if (!IsSecret(subscription.Auth))
      refused.Add(new RefusedMember(AUTH, NOT_A_SECRET));

    return refused;
  }

  /// <summary>Whether <paramref name="text"/> is the 65-byte uncompressed P-256 point (0x04, X, Y) in base64url without padding.</summary>
  private static bool IsPublicKey(string text) =>
    StrictBase64Url.Decode(text) is { Length: POINT_BYTES } point && point[0] == UNCOMPRESSED_POINT;

  /// <summary>Whether <paramref name="text"/> is 16 bytes in base64url without padding.</summary>
  private static bool IsSecret(string text) => StrictBase64Url.Decode(text) is { Length: SECRET_BYTES };
}