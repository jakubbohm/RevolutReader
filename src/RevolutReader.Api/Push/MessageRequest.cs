namespace RevolutReader.Api.Push;

/// <summary>
/// The owner's message (c011 design.md D10): the target account (an email address) and the message, its title, its
/// optional text and the optional page a tap opens. Every member optional here, so a missing one is the endpoint's
/// refusal, naming it, never a binding failure.
/// </summary>
public sealed record MessageRequest(string? Account, string? Title, string? Text, string? Page);