namespace RevolutReader.Api.Push;

/// <summary>The message rules (c011 design.md D2, D10), pure.</summary>
public static class PushMessages {
  /// <summary>The Declarative Web Push JSON: web_push 8030, title, body when there is text, navigate = appAddress + page.</summary>
  public static string DeclarativeJson(PushMessage message, Uri appAddress) => throw new NotImplementedException();
}