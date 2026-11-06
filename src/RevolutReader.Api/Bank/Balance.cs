namespace RevolutReader.Api.Bank;

/// <summary>The account's available balance (c004 design.md D3).</summary>
public sealed record Balance(decimal Amount, string Currency);