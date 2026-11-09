namespace RevolutReader.Api.Account;

/// <summary>The balance as the app shows it (c009 design.md D1): euros, the server's read time, the koruna rate.</summary>
public sealed record AccountBalance(decimal Amount, DateTimeOffset ReadAt, decimal CzkPerEur);