namespace RevolutReader.Api.Push;

/// <summary>What a sent message came to (c011 design.md D3, D10): counts of the account's devices reached, failed and kept, removed as gone.</summary>
public sealed record MessageOutcomeResponse(int Delivered, int Failed, int Removed);