using Microsoft.Extensions.Primitives;

namespace RevolutReader.Api.Push;

/// <summary>The message key's check (c011 design.md D10): SHA-256 of both, compared in constant time; missing or repeated → false.</summary>
public static class MessageKeyCheck {
  public static bool Matches(StringValues sent, string messageKey) => throw new NotImplementedException();
}