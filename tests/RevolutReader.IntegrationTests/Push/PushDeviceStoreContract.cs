using System.Buffers.Text;
using System.Security.Cryptography;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.IntegrationTests.Push;

/// <summary>
/// The contract of the push device store (c011 design.md § Ports and contracts, D11), written only against
/// <see cref="IPushDeviceStore"/>, and run against both the in-memory fake the unit tests use
/// (<see cref="InMemoryPushDeviceStoreContract"/>) and the Table adapter on Azurite
/// (<see cref="TablePushDeviceStoreContract"/>), so the fake stays honest:
/// <list type="bullet">
/// <item><c>ReadAll</c>: every stored device, in no promised order; an empty store reads as no devices; every field comes
/// back as saved, the push address unchanged, with its query, its escapes, its slashes, question marks and hashes.</item>
/// <item><c>Save</c>: inserts or replaces the device by its push address, whole: saving the same address again leaves one
/// device with the latest keys and account.</item>
/// <item><c>Forget</c>: deletes the device with that push address and no other; an address not stored does nothing and
/// raises nothing, also in a store that has never held a device, and also for an empty or blank address.</item>
/// </list>
/// Each test starts from a new, empty store of its own (<see cref="NewStore"/>: for the adapter, a table no other test
/// uses) and saves its own made-up devices, each at a push address of its own (a new token each time). The accounts are
/// made up; the keys are generated as a browser makes them.
/// </summary>
public abstract class PushDeviceStoreContract {
  private const string LUCIE = "lucie@example.com";
  private const string PETR = "petr@example.com";

  [Test]
  public async Task An_empty_store_reads_as_no_devices() {
    IPushDeviceStore store = NewStore();

    (await store.ReadAll(CancellationToken.None)).ShouldBeEmpty();
  }

  /// <summary>
  /// A push address shaped as Microsoft's are, its token in the query, escaped (<c>%2b</c>, <c>%2f</c>, <c>%3d</c>), which
  /// must come back neither decoded nor re-encoded; and an account in mixed case, kept as the sign-in gave it (D11).
  /// </summary>
  [Test]
  public async Task A_saved_device_reads_back_with_every_field_unchanged_a_push_address_with_a_query_included() {
    IPushDeviceStore store = NewStore();
    PushDevice device = Device("Lucie@Example.com", $"https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB{Token()}%2bHk%2fM%3d");

    await store.Save(device, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldHaveSingleItem().ShouldBe(device);
  }

  [Test]
  public async Task Saving_the_same_push_address_again_leaves_one_device_with_the_latest_keys() {
    IPushDeviceStore store = NewStore();
    PushDevice first = Device(LUCIE);
    PushDevice again = Device(LUCIE, first.Endpoint);
    await store.Save(first, CancellationToken.None);

    await store.Save(again, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldHaveSingleItem().ShouldBe(again);
  }

  [Test]
  public async Task Saving_a_push_address_under_another_account_moves_the_device_to_it() {
    IPushDeviceStore store = NewStore();
    PushDevice lucies = Device(LUCIE);
    await store.Save(lucies, CancellationToken.None);

    await store.Save(lucies with { Account = PETR }, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldHaveSingleItem().ShouldBe(lucies with { Account = PETR });
  }

  [Test]
  public async Task Forgetting_a_device_removes_it_and_leaves_the_others() {
    IPushDeviceStore store = NewStore();
    PushDevice phone = Device(LUCIE);
    PushDevice tablet = Device(LUCIE);
    PushDevice petrsPhone = Device(PETR);
    foreach (PushDevice device in new[] { phone, tablet, petrsPhone })
      await store.Save(device, CancellationToken.None);

    await store.Forget(tablet.Endpoint, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe([phone, petrsPhone], ignoreOrder: true);
  }

  /// <param name="storeHolds">Whether the store holds another device, or has never held any (for the adapter, its table not yet made).</param>
  [Test]
  [Arguments("another device")]
  [Arguments("nothing, ever")]
  public async Task Forgetting_a_push_address_that_is_not_stored_does_nothing(string storeHolds) {
    IPushDeviceStore store = NewStore();
    PushDevice[] stored = storeHolds switch {
      "another device" => [Device(LUCIE)],
      "nothing, ever" => [],
      _ => throw new ArgumentOutOfRangeException(nameof(storeHolds), storeHolds, "Not a known case."),
    };
    foreach (PushDevice device in stored)
      await store.Save(device, CancellationToken.None);

    await store.Forget(PushAddress(), CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe(stored, ignoreOrder: true);
  }

  /// <summary>
  /// The forget handler passes an empty or blank push address to the store as it is (D9: no address is fine), so the
  /// store must take one: it deletes nothing, never every device, and raises nothing.
  /// </summary>
  /// <param name="pushAddress">An empty push address, or one of only spaces.</param>
  [Test]
  [Arguments("")]
  [Arguments("   ")]
  public async Task Forgetting_an_empty_or_blank_push_address_does_nothing(string pushAddress) {
    IPushDeviceStore store = NewStore();
    PushDevice[] stored = [Device(LUCIE), Device(PETR)];
    foreach (PushDevice device in stored)
      await store.Save(device, CancellationToken.None);

    await store.Forget(pushAddress, CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).ShouldBe(stored, ignoreOrder: true);
  }

  /// <summary>
  /// Table Storage forbids <c>/</c>, <c>?</c> and <c>#</c> in a key (D11). The three addresses differ only in the character
  /// before the last segment, so a key that replaced or dropped those characters would make them one device.
  /// </summary>
  [Test]
  public async Task A_push_address_with_a_slash_a_question_mark_and_a_hash_reads_back_unchanged() {
    IPushDeviceStore store = NewStore();
    string token = Token();
    string[] pushAddresses = [
      $"https://push.example.net/push/{token}/x",
      $"https://push.example.net/push/{token}?x",
      $"https://push.example.net/push/{token}#x",
    ];

    foreach (string pushAddress in pushAddresses)
      await store.Save(Device(LUCIE, pushAddress), CancellationToken.None);

    (await store.ReadAll(CancellationToken.None)).Select(static device => device.Endpoint).ShouldBe(pushAddresses, ignoreOrder: true);
  }

  /// <summary>A new, empty store of the test's own.</summary>
  protected abstract IPushDeviceStore NewStore();

  /// <summary>A device of <paramref name="account"/> at <paramref name="pushAddress"/> (a new one when none is given), with new keys as a browser makes them.</summary>
  private static PushDevice Device(string account, string? pushAddress = null) {
    byte[] point = RandomNumberGenerator.GetBytes(65);
    point[0] = 0x04;

    return new PushDevice(
      pushAddress ?? PushAddress(),
      Base64Url.EncodeToString(point),
      Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
      account);
  }

  /// <summary>A new push address shaped as Google's are, with a made-up token.</summary>
  private static string PushAddress() => $"https://fcm.googleapis.com/fcm/send/{Token()}";

  private static string Token() => $"made-up-{Guid.NewGuid():N}";
}