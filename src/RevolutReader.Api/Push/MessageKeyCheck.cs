using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Primitives;

namespace RevolutReader.Api.Push;

/// <summary>
/// The message key's check (c011 design.md D10): the key sent in <see cref="HEADER"/> matches the configured message key.
/// Both are hashed with SHA-256 and the hashes compared in constant time, so neither the time taken nor a length tells
/// a caller anything; a header sent twice, or not at all, does not match.
/// </summary>
public static class MessageKeyCheck {
  /// <summary>The request header the message key travels in (D10).</summary>
  public const string HEADER = "X-Message-Key";

  /// <summary>Whether <paramref name="sent"/>, the header's values, is exactly one value equal to <paramref name="messageKey"/>.</summary>
  public static bool Matches(StringValues sent, string messageKey) {
    ArgumentNullException.ThrowIfNull(messageKey);

    return sent.Count == 1 && sent[0] is { } key && CryptographicOperations.FixedTimeEquals(Hash(key), Hash(messageKey));
  }

  private static byte[] Hash(string text) => SHA256.HashData(Encoding.UTF8.GetBytes(text));
}