using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevolutReader.Api.Push;

/// <summary>The balance in a notification's address (c019 design.md D2, D3), pure.</summary>
public static class BalanceInAddress {
  /// <summary>The fragment's name: <c>#balance=&lt;payload&gt;.&lt;code&gt;</c>.</summary>
  public const string NAME = "balance";

  /// <summary>A push subscription's authentication secret, in bytes (RFC 8291 § 3.2).</summary>
  public const int SECRET_BYTES = 16;

  /// <summary>The bytes of the check code's key and of its HMAC-SHA-256 (D3).</summary>
  private const int CODE_BYTES = 32;

  /// <summary>HKDF's salt for the check code's key (D3): this app's own, so the key is no other use of the secret.</summary>
  private static readonly byte[] _salt = Encoding.ASCII.GetBytes("tarjeta-papa");

  /// <summary>HKDF's info for the check code's key (D3); <c>v1</c> lets a later construction live beside this one.</summary>
  private static readonly byte[] _info = Encoding.ASCII.GetBytes("notification balance check code v1");

  /// <summary>
  /// The JSON <c>GET /api/balance</c> writes: ASP.NET's web defaults (camel-case names, numbers as JSON numbers), with an
  /// encoder that writes <c>+</c> of the read time's offset as it is rather than as an escape. The payload is base64url,
  /// never put into HTML, so escaping the HTML-sensitive characters protects nothing, and the page parses the same JSON
  /// either way; the bytes, which the check code signs, are pinned by design.md D12's known-answer vector.
  /// </summary>
  private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

  /// <summary><c>balance=&lt;payload&gt;.&lt;code&gt;</c>, without the <c>#</c>; throws <see cref="ArgumentException"/> for a secret not of 16 bytes.</summary>
  public static string Fragment(PushBalance balance, ReadOnlySpan<byte> deviceSecret) {
    ArgumentNullException.ThrowIfNull(balance);
    RequireSecret(deviceSecret);

    string payload = Payload(balance);

    return $"{NAME}={payload}.{CheckCode(payload, deviceSecret)}";
  }

  /// <summary>The balance's JSON as <c>GET /api/balance</c> writes it, UTF-8, base64url without padding.</summary>
  public static string Payload(PushBalance balance) {
    ArgumentNullException.ThrowIfNull(balance);

    byte[] json = JsonSerializer.SerializeToUtf8Bytes(new BalanceJson(balance.Amount, balance.ReadAt, balance.CzkPerEur), _json);

    return Base64Url.EncodeToString(json);
  }

  /// <summary>HMAC-SHA-256 of the payload's text under the key HKDF derives from the secret (D3), base64url, 43 characters.</summary>
  public static string CheckCode(string payload, ReadOnlySpan<byte> deviceSecret) {
    ArgumentNullException.ThrowIfNull(payload);
    RequireSecret(deviceSecret);

    Span<byte> key = stackalloc byte[CODE_BYTES];
    HKDF.DeriveKey(HashAlgorithmName.SHA256, deviceSecret, key, _salt, _info);

    Span<byte> code = stackalloc byte[CODE_BYTES];
    HMACSHA256.HashData(key, Encoding.ASCII.GetBytes(payload), code);
    CryptographicOperations.ZeroMemory(key);

    return Base64Url.EncodeToString(code);
  }

  /// <summary>Refuses a secret not of <see cref="SECRET_BYTES"/> bytes, naming it, never its value.</summary>
  private static void RequireSecret(ReadOnlySpan<byte> deviceSecret) {
    if (deviceSecret.Length != SECRET_BYTES)
      throw new ArgumentException($"A device's push secret is {SECRET_BYTES} bytes.", nameof(deviceSecret));
  }

  /// <summary>The balance as <c>GET /api/balance</c> names its members, in its order (<c>BalanceResponse</c>).</summary>
  private sealed record BalanceJson(
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("readAt")] DateTimeOffset ReadAt,
    [property: JsonPropertyName("czkPerEur")] decimal CzkPerEur);
}