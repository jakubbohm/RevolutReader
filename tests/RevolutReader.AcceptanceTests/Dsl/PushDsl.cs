using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Push, as the scenarios state it (specs push-devices and push-sending, c011 design.md D7): phones that subscribe for
/// pushes; their registration, in the browser <see cref="SignInDsl"/> signed in with; the owner's messages, sent through
/// the message endpoint with the message key; what each phone's push service received and what reached the phone; and,
/// for a device registered before its account left the allowlist, the app's storage. One fake push service per test
/// (<see cref="FakePushService"/>), where every phone has its push address and its own keys (<see cref="TestDevice"/>).
/// <para>
/// Defaults: a phone is known by the name the scenario gives it, unique within the test; registering a phone sends its
/// own subscription, well-formed; registering at an address the scenario names sends well-formed keys, so only the
/// address can be refused; a message has no text and no page unless the scenario gives them; a wrong message key is as
/// long as the key, and never it.
/// </para>
/// </summary>
public sealed class PushDsl(PushDriver driver, FakePushService pushService) {
  /// <summary>The test device behind each phone the scenario made (<see cref="NewPhone"/>).</summary>
  private readonly Dictionary<PhoneForPush, TestDevice> _devices = [];

  /// <summary>The server's public push key (VAPID), the one the app copy is configured with.</summary>
  public string ServerPushKey => pushService.VapidPublicKey;

  // Phones and their push services (GIVEN)

  /// <summary>A new phone named <paramref name="name"/>, subscribed at the fake push service with keys of its own; not registered with the app yet.</summary>
  public PhoneForPush NewPhone(string name) {
    PhoneForPush phone = new(name);

    if (_devices.ContainsKey(phone))
      throw new InvalidOperationException($"The scenario already has a phone named {name}: give each phone its own name.");

    _devices.Add(phone, pushService.NewDevice(name));

    return phone;
  }

  /// <summary>From now on, <paramref name="phone"/>'s push service answers that the phone is gone.</summary>
  public void PushServiceSaysGone(PhoneForPush phone) => pushService.Gone(DeviceOf(phone));

  /// <summary><paramref name="phone"/>'s push service fails with an error of its own once: the next push to the phone.</summary>
  public void PushServiceFailsOnce(PhoneForPush phone) => pushService.FailsOnce(DeviceOf(phone));

  // The signed-in user's browser (GIVEN and WHEN)

  /// <summary>The signed-in user's browser asks the API for the push key.</summary>
  public Task<string> AsksForThePushKey() => driver.AskForThePushKey();

  /// <summary>The signed-in user's browser registers <paramref name="phone"/> for pushes, with its own subscription.</summary>
  public Task<RegistrationAnswer> Registers(PhoneForPush phone) => driver.Register(DeviceOf(phone));

  /// <summary>
  /// The signed-in user has registered <paramref name="phone"/> for pushes: the browser registers it, and the API answers
  /// that it is registered; throws otherwise, so a scenario never rests on a registration that never worked.
  /// </summary>
  public async Task HasRegistered(PhoneForPush phone) {
    RegistrationAnswer answer = await Registers(phone);

    if (answer != RegistrationAnswer.Registered)
      throw new InvalidOperationException($"The scenario needs {phone} registered for pushes, but registering it answered {answer}.");
  }

  /// <summary>The signed-in user's browser registers a subscription whose push address is <paramref name="pushAddress"/>, with well-formed keys.</summary>
  public Task<RegistrationAnswer> RegistersAt(string pushAddress) => driver.RegisterAt(pushAddress);

  /// <summary>The signed-in user's browser registers <paramref name="phone"/>'s subscription with a secret of <paramref name="bytes"/> bytes instead of its own.</summary>
  public Task<RegistrationAnswer> RegistersWithSecretOfBytes(PhoneForPush phone, int bytes) => driver.RegisterWithSecretOfBytes(DeviceOf(phone), bytes);

  /// <summary>The signed-in user's browser forgets <paramref name="phone"/>.</summary>
  public Task<ForgetAnswer> Forgets(PhoneForPush phone) => driver.Forget(DeviceOf(phone));

  // The owner's messages (WHEN)

  /// <summary>
  /// The owner sends a message to <paramref name="account"/> through the message endpoint, with the message key: titled
  /// <paramref name="title"/>, with <paramref name="text"/> and <paramref name="page"/> when given (<see langword="null"/>:
  /// the message has none of that part).
  /// </summary>
  public Task<MessageAnswer> OwnerSends(string account, string? title, string? text = null, string? page = null) => driver.SendMessage(account, title, text, page);

  /// <summary>Someone sends a message titled <paramref name="title"/> to <paramref name="account"/> through the message endpoint, with a wrong message key.</summary>
  public Task<WholeAnswer> SomeoneSendsWithAWrongKey(string account, string title) => driver.SendMessageWithAWrongKey(account, title);

  /// <summary>What an unknown <c>/api</c> address answers the same request the last message with a wrong key was.</summary>
  public Task<WholeAnswer> AnUnknownApiAddressAnswers() => driver.SendTheSameToAnUnknownApiAddress();

  // The app's storage (GIVEN and THEN)

  /// <summary>
  /// <paramref name="phone"/> is registered for pushes under <paramref name="account"/>, written into the app's storage as a
  /// registration would have written it, for an account that has since left the allowlist and so can no longer register
  /// through the API; throws unless the storage then holds the phone.
  /// </summary>
  public async Task DeviceRegisteredFor(PhoneForPush phone, string account) {
    TestDevice device = DeviceOf(phone);

    await driver.SaveDeviceFor(device, account);

    if (!await driver.IsRegistered(device))
      throw new InvalidOperationException($"The scenario needs {phone} registered for {account}, but the app's storage does not hold it.");
  }

  /// <summary>Whether <paramref name="phone"/> is still registered for pushes, under any account.</summary>
  public Task<bool> IsRegistered(PhoneForPush phone) => driver.IsRegistered(DeviceOf(phone));

  // What arrived (THEN)

  /// <summary>Every push <paramref name="phone"/>'s push service received, in the order received, whatever it answered.</summary>
  public IReadOnlyList<PushReceived> PushServiceReceived(PhoneForPush phone) => driver.PushesReceivedFor(DeviceOf(phone));

  /// <summary>Every push that reached <paramref name="phone"/>, in the order received: those its push service accepted.</summary>
  public IReadOnlyList<PushReceived> Received(PhoneForPush phone) => [.. PushServiceReceived(phone).Where(static push => push.ReachedThePhone)];

  /// <summary>How many pushes any push service received, for any device: the fake push service is the only one a test reaches.</summary>
  public int PushesAnyPushServiceReceived() => driver.PushesReceivedAtAll();

  /// <summary>The app's own address of <paramref name="page"/> (a path such as <c>/</c>): what a tap on a push opens.</summary>
  public string AppAddressOf(string page) => new Uri(new Uri(pushService.AppAddress), page).AbsoluteUri;

  /// <summary>The test device behind <paramref name="phone"/>; throws when the scenario made no such phone.</summary>
  private TestDevice DeviceOf(PhoneForPush phone) {
    ArgumentNullException.ThrowIfNull(phone);

    return _devices.TryGetValue(phone, out TestDevice? device)
      ? device
      : throw new InvalidOperationException($"The scenario has no phone named {phone.Name}: make it with {nameof(NewPhone)} first.");
  }
}