namespace RevolutReader.Api.Account;

/// <summary>A transaction's first sighting to record (c018 design.md D1): the bank's reference and the moment, in UTC, to the whole second.</summary>
/// <param name="Reference">The bank's <c>entry_reference</c>.</param>
/// <param name="At">When the read that saw it got the bank's answer (<see cref="FirstSeenRule.ReadAt"/>).</param>
public sealed record FirstSeen(string Reference, DateTimeOffset At);