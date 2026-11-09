namespace RevolutReader.Api.Push;

/// <summary>Checks the push address against the known services and the keys' sizes; saves under the account (c011 design.md D9).</summary>
public sealed class RegisterDeviceHandler {
  public RegisterDeviceHandler(IPushDeviceStore store, KnownPushServices services) => throw new NotImplementedException();

  public Task<RegistrationResult> Handle(DeviceSubscription subscription, string account, CancellationToken cancellationToken) => throw new NotImplementedException();
}