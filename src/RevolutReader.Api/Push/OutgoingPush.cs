namespace RevolutReader.Api.Push;

/// <summary>One push to one device (c011 design.md D2): the content, how long the push service keeps it, how urgent it is.</summary>
public sealed record OutgoingPush(string Content, TimeSpan Lifetime, PushUrgency Urgency);

/// <summary>How urgent a push is (RFC 8030 § 5.3).</summary>
public enum PushUrgency {
  VeryLow,
  Low,
  Normal,
  High,
}