namespace RevolutReader.Api.Rate;

/// <summary>
/// The answer to <c>GET /cnbapi/exrates/daily</c> (c017 design.md D1, § Context: the CNB's answer captured 2026-11-21,
/// <c>tests/RevolutReader.AcceptanceTests/Drivers/CnbDaily.json</c>), with only what <see cref="CnbClient"/> reads. Every
/// member may be missing or null in an answer, so the client checks each one it reads (D6).
/// </summary>
public sealed record CnbDailyRates(IReadOnlyList<CnbDailyRate?>? Rates);

/// <summary>
/// One currency's entry: its <c>currencyCode</c>, such as <c>EUR</c>; its <c>rate</c> in koruna for <c>amount</c> units
/// (1 for the euro, 100 for some currencies), each zero when missing; and <c>validFor</c>, the day the rate is for, as
/// <c>yyyy-MM-dd</c>.
/// </summary>
public sealed record CnbDailyRate(string? CurrencyCode, decimal Amount, decimal Rate, string? ValidFor);