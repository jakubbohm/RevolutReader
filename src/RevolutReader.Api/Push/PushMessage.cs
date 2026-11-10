namespace RevolutReader.Api.Push;

/// <summary>A message (c011 design.md D2, D10): the title, the optional text, the page a tap opens ("/" when none).</summary>
public sealed record PushMessage(string Title, string? Text, string Page = "/");