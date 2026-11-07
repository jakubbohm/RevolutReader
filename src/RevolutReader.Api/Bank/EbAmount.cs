namespace RevolutReader.Api.Bank;

/// <summary>Enable Banking's <c>AmountType</c> (API reference): the currency, and the amount as the bank writes it, a string.</summary>
public sealed record EbAmount(string Currency, string Amount);