namespace RevolutReader.Api.Push;

/// <summary>A device as kept (c011 design.md D3, D11): its push address, its two keys (base64url) and the account it registered under.</summary>
public sealed record PushDevice(string Endpoint, string P256dh, string Auth, string Account);