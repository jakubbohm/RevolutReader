using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Primitives;

namespace RevolutReader.Api.Push;

/// <summary>
/// A key's check for an anonymous endpoint that only a key opens: the key a request sends in a header matches the
/// configured key. Written for the message key (c011 design.md D10: <see cref="HEADER"/> against
/// <see cref="PushOptions.MessageKey"/>), and it compares any sent header with any key: the account check uses it for its
/// own key (c014 design.md D6). Both are hashed with SHA-256 and the hashes compared in constant time, so neither the time
/// taken nor a length tells a caller anything; a header sent twice, or not at all, does not match.
/// </summary>
public static class MessageKeyCheck {
  /// <summary>The request header the message key travels in (D10).</summary>
  public const string HEADER = "X-Message-Key";

  /// <summary>Whether <paramref name="sent"/>, a key header's values, is exactly one value equal to <paramref name="key"/>.</summary>
  public static bool Matches(StringValues sent, string key) {
    ArgumentNullException.ThrowIfNull(key);

    return sent.Count == 1 && sent[0] is { } sentKey && CryptographicOperations.FixedTimeEquals(Hash(sentKey), Hash(key));
  }

  private static byte[] Hash(string text) => SHA256.HashData(Encoding.UTF8.GetBytes(text));
}