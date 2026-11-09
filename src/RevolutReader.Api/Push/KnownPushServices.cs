using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>The known push services (c011 design.md D9): whether a push address may be registered.</summary>
public sealed class KnownPushServices {
  public KnownPushServices(IOptions<PushOptions> options) => throw new NotImplementedException();

  public bool Accepts(string pushAddress) => throw new NotImplementedException();
}