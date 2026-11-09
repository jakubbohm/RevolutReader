using System.Diagnostics;

namespace RevolutReader.Api.Push;

/// <summary>
/// Registers a device (spec push-devices, c011 design.md D3, D9, D11): a subscription whose push address lies at a known
/// push service (<see cref="KnownPushServices"/>) and that has both keys is saved under the signed-in account, replacing
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

    if (subscription.Auth is null)
      refused.Add(new RefusedMember(AUTH, MISSING));

    return refused;
  }
}