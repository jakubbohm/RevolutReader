namespace RevolutReader.Api.Bank;

/// <summary>In the bank's order (newest first for Revolut), pages joined (c004 design.md D7).</summary>
public sealed record Transactions(IReadOnlyList<BankTransaction> Items);