using System.Buffers;
using System.Buffers.Text;

namespace RevolutReader.Api.Push;

/// <summary>
/// Base64url without padding, read strictly (RFC 4648, § 5), as the push keys are written: the settings' keys (c011
/// design.md D5) and a browser's subscription keys, which <c>PushSubscription.toJSON()</c> encodes without padding (D9).
/// </summary>
internal static class StrictBase64Url {
  /// <summary>Base64url's alphabet, without padding.</summary>
  private static readonly SearchValues<char> _alphabet =
    SearchValues.Create("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");

  /// <summary>
  /// The bytes <paramref name="text"/> holds, or null when it holds anything else: nothing, a character outside the
  /// alphabet (standard base64's "+" and "/", padding, white space, which the platform's decoder would skip) or a length or
  /// last character no encoder writes.
  /// </summary>
  public static byte[]? Decode(string? text) {
    if (string.IsNullOrEmpty(text) || text.AsSpan().ContainsAnyExcept(_alphabet))
      return null;

    byte[] bytes = new byte[Base64Url.GetMaxDecodedLength(text.Length)];

    return Base64Url.DecodeFromChars(text, bytes, out _, out int written) == OperationStatus.Done ? bytes[..written] : null;
  }
}