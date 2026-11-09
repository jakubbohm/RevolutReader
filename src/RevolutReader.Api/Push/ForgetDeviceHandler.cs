namespace RevolutReader.Api.Push;

/// <summary>Forgets the device with this push address; none stored, or no address, is fine (c011 design.md D9).</summary>
public sealed class ForgetDeviceHandler {
  public ForgetDeviceHandler(IPushDeviceStore store) => throw new NotImplementedException();

  public Task Handle(string? endpoint, CancellationToken cancellationToken) => throw new NotImplementedException();
}