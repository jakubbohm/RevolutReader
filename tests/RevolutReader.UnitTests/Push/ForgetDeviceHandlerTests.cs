using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Forgetting a device (spec push-devices, "A device can be forgotten"; c011 design.md D9, D11, § Ports and contracts):
/// the device with exactly that push address is deleted, so it gets no more messages; every other device stays as it was,
/// the same account's and other accounts'. A device is known by its push address as stored, compared exactly (D11 keys
/// the table by the address's own bytes): an address that differs only in the case of its token, or that merely starts
/// with the forgotten one, is another device. The handler runs on the in-memory store; every push address and key is
/// made up.
/// </summary>
public sealed class ForgetDeviceHandlerTests {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";

  /// <param name="pushAddressAtTheService">The forgotten device's push address at its service, without its token.</param>
  [Test]
  [Arguments("https://fcm.googleapis.com/fcm/send/")] // its token in the path
  [Arguments("https://wns2-par02p.notify.windows.com/w/?token=")] // Microsoft's: its token in the query
  public async Task Forgetting_a_stored_device_removes_it(string pushAddressAtTheService) {
    InMemoryPushDeviceStore store = new();
    string token = MadeUpToken();
    PushDevice luciesPhone = Device($"{pushAddressAtTheService}{token}", LUCIE);
    PushDevice luciesTablet = Device($"https://web.push.apple.com/{MadeUpToken()}", LUCIE);
    PushDevice petrsLaptop = Device($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", PETR);
    PushDevice tokenInOtherCase = Device($"{pushAddressAtTheService}{token.ToUpperInvariant()}", PETR);
    PushDevice longerAddress = Device($"{pushAddressAtTheService}{token}-2", PETR);
    foreach (PushDevice device in (PushDevice[])[luciesPhone, luciesTablet, petrsLaptop, tokenInOtherCase, longerAddress])
      await store.Save(device, CancellationToken.None);

    await new ForgetDeviceHandler(store).Handle(luciesPhone.Endpoint, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe(
      [luciesTablet, petrsLaptop, tokenInOtherCase, longerAddress],
      ignoreOrder: true,
      "only Lucie's phone is gone: her tablet, Petr's laptop and the two devices whose addresses only resemble the phone's stay as they were");
  }

  /// <summary>A device at <paramref name="pushAddress"/> under <paramref name="account"/>, with made-up keys the store does not read.</summary>
  private static PushDevice Device(string pushAddress, string account) =>
    new(pushAddress, $"made-up-public-key-{Guid.NewGuid():N}", $"made-up-secret-{Guid.NewGuid():N}", account);

  /// <summary>A made-up token where a push service puts the device's own part of the address, lowercase.</summary>
  private static string MadeUpToken() => $"made-up-{Guid.NewGuid():N}";
}