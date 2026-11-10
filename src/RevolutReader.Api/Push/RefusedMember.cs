namespace RevolutReader.Api.Push;

/// <summary>A member a request names wrongly and the fixed reason, never the value (c011 design.md D9, D10).</summary>
public sealed record RefusedMember(string Member, string Reason);