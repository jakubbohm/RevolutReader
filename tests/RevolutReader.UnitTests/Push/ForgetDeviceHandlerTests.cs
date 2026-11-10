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

  /// <summary>
  /// Forgetting an address no device is stored under is fine (D9: a browser can always forget its device, e.g. at
  /// sign-out): it completes without an exception and forgets nothing, also when the address only resembles a stored one.
  /// </summary>
  /// <param name="notStored">The forgotten address: one no device was ever stored under, or one that resembles Lucie's phone's.</param>
  [Test]
  [Arguments("an address never stored")]
  [Arguments("the phone's address with its token in upper case")]
  [Arguments("the phone's address cut short by one character")] // a stored address starts with it
  [Arguments("the phone's address and one character more")] // it starts with a stored address
  [Arguments("the phone's token at another push service")]
  [Arguments("an address in a store that has never held a device")]
  public async Task Forgetting_a_push_address_that_is_not_stored_is_fine(string notStored) {
    InMemoryPushDeviceStore store = new();
    string token = MadeUpToken();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{token}", LUCIE);
    PushDevice petrsLaptop = Device($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", PETR);
    PushDevice[] stored = notStored == "an address in a store that has never held a device" ? [] : [luciesPhone, petrsLaptop];
    foreach (PushDevice device in stored)
      await store.Save(device, CancellationToken.None);
    string pushAddress = notStored switch {
      "an address never stored" or "an address in a store that has never held a device" => $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}",
      "the phone's address with its token in upper case" => $"https://fcm.googleapis.com/fcm/send/{token.ToUpperInvariant()}",
      "the phone's address cut short by one character" => luciesPhone.Endpoint[..^1],
      "the phone's address and one character more" => $"{luciesPhone.Endpoint}0",
      "the phone's token at another push service" => $"https://web.push.apple.com/{token}",
      _ => throw new ArgumentOutOfRangeException(nameof(notStored), notStored, "Not a known case."),
    };

    await new ForgetDeviceHandler(store).Handle(pushAddress, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe(stored, ignoreOrder: true, "nothing is forgotten");
  }

  /// <summary>
  /// Forgetting without a push address is fine (D9): none, an empty one or one of only spaces completes without an
  /// exception and forgets nothing, never every device, as a match by prefix or by containment would with an empty one.
  /// </summary>
  /// <param name="pushAddress">No push address: <see langword="null"/>, empty, or only spaces.</param>
  [Test]
  [Arguments(null)]
  [Arguments("")]
  [Arguments("   ")]
  public async Task Forgetting_without_a_push_address_is_fine(string? pushAddress) {
    InMemoryPushDeviceStore store = new();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", LUCIE);
    PushDevice petrsLaptop = Device($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", PETR);
    await store.Save(luciesPhone, CancellationToken.None);
    await store.Save(petrsLaptop, CancellationToken.None);

    await new ForgetDeviceHandler(store).Handle(pushAddress, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe([luciesPhone, petrsLaptop], ignoreOrder: true, "nothing is forgotten");
  }

  /// <summary>A device at <paramref name="pushAddress"/> under <paramref name="account"/>, with made-up keys the store does not read.</summary>
  private static PushDevice Device(string pushAddress, string account) =>
    new(pushAddress, $"made-up-public-key-{Guid.NewGuid():N}", $"made-up-secret-{Guid.NewGuid():N}", account);

  /// <summary>A made-up token where a push service puts the device's own part of the address, lowercase.</summary>
  private static string MadeUpToken() => $"made-up-{Guid.NewGuid():N}";
}