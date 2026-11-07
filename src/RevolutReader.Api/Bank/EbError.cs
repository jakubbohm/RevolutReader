namespace RevolutReader.Api.Bank;

/// <summary>
/// An error answer's body (API reference <c>ErrorResponse</c>, <c>{ message, code, error, detail }</c>; Mock ASPSP capture
/// <c>spikes/enable-banking-mock/evidence/2026-11-04-error-responses.json</c>), with only what the classification reads:
/// the <c>error</c> code. The <c>message</c> and <c>detail</c> texts are never read (c004 design.md D5).
/// </summary>
/// <param name="Error">Enable Banking's error code, such as <c>EXPIRED_SESSION</c>; may be missing.</param>
public sealed record EbError(string? Error);