namespace RevolutReader.Api.Push;

/// <summary>The balance a notification about the account carries (c014 design.md D14), as <c>GET /api/balance</c> answers it.</summary>
public sealed record PushBalance(decimal Amount, DateTimeOffset ReadAt, decimal CzkPerEur);