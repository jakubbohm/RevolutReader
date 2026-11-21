namespace RevolutReader.Api.Check;

/// <summary>
/// What the check endpoint answers the Shortcut (c014 design.md D11), exactly <c>{ "changed": true | false }</c>: whether,
/// after the check's read and store, last seen differs from last notified.
/// </summary>
public sealed record AccountCheckResponse(bool Changed);