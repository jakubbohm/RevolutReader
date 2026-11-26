namespace RevolutReader.Api.Push;

/// <summary>
/// A message (c011 design.md D2, D10): the title, the optional text, the page a tap opens ("/" when none); and, for a
/// notification about the account, the balance it carries (c014 design.md D14), none otherwise. Temporary, for the
/// iPhone test of #113: the owner's message may carry a made-up balance as <paramref name="Test"/>, never as
/// <paramref name="Balance"/>.
/// </summary>
public sealed record PushMessage(string Title, string? Text, string Page = "/", PushBalance? Balance = null, PushBalance? Test = null);