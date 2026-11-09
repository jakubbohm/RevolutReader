namespace RevolutReader.Api.Push;

/// <summary>The sender's answer (c011 design.md D3).</summary>
public union SendResult(PushSent, AccountNotAllowed);

/// <summary>The counts of the account's devices: reached, failed and kept, removed as gone.</summary>
public sealed record PushSent(int Delivered, int Failed, int Removed);

/// <summary>The account is not on the allowlist; its devices are deleted.</summary>
public sealed record AccountNotAllowed;