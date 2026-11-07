namespace RevolutReader.Api.Bank;

/// <summary>
/// A read's result (c004 design.md D4): the value, or one of the bank's three expected failures. The failure records are
/// declared next to the union, not nested in it, so they are one type whatever the value's type.
/// </summary>
public union BankResult<T>(T, BankAccessExpired, BankRateLimited, BankUnavailable);

/// <summary>The bank session expired, was revoked or closed, or the bank no longer gives access: only the owner can fix it.</summary>
public sealed record BankAccessExpired;

/// <summary>The bank's request limit is reached. Never retried.</summary>
public sealed record BankRateLimited;

/// <summary>The bank reported an error or a timeout of its own, did not answer in time, or could not be reached.</summary>
public sealed record BankUnavailable;