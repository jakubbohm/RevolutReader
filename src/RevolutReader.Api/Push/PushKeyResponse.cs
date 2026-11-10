using System.ComponentModel;

namespace RevolutReader.Api.Push;

/// <summary>
/// The server's public push key (spec push-devices, c011 design.md D9): exactly the key, nothing else. The descriptions are
/// the API description's, in plain words.
/// </summary>
[Description("The server's public push key, which the app subscribes to push notifications with")]
public sealed record PushKeyResponse(
  [property: Description("The VAPID public key (RFC 8292): the uncompressed P-256 point, base64url without padding")] string PublicKey);