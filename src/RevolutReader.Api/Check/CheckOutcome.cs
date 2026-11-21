namespace RevolutReader.Api.Check;

/// <summary>What a check came to (c014 design.md D11): whether last seen and last notified differ after its read and store.</summary>
public sealed record CheckOutcome(bool Changed);