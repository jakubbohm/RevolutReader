using System.Buffers;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The token every request to Enable Banking carries (c004 design.md § Context, § Rule ownership): a JWT signed by the
/// application's private key, as the API reference § Authentication specifies and the M1 spike's <c>eb-client.ps1</c>
/// builds it.
/// </summary>
public sealed class ApplicationToken {
  private const string ISSUER = "enablebanking.com";
  private const string AUDIENCE = "api.enablebanking.com";

  /// <summary>One hour; the API reference allows at most a day (docs/operations/expiring-approvals.md).</summary>
  private static readonly TimeSpan _lifetime = TimeSpan.FromHours(1);

  /// <summary>The header, base64url-encoded: the same for every token of the application.</summary>
  private readonly string _encodedHeader;

  private readonly RSA _key;

  /// <summary>
  /// One signature at a time: .NET documents no thread safety for a shared <see cref="RSA"/> instance, and the token is a
  /// singleton whose reads may run in parallel (C7 may read balance and transactions at once).
  /// </summary>
  private readonly Lock _signing = new();

  /// <param name="applicationId">The JWT's key id.</param>
  /// <param name="key">The application's private key; the caller owns it and keeps it alive.</param>
  public ApplicationToken(string applicationId, RSA key) {
    ArgumentException.ThrowIfNullOrWhiteSpace(applicationId);
    ArgumentNullException.ThrowIfNull(key);

    _encodedHeader = Base64UrlJson(header => {
      header.WriteString("typ", "JWT");
      header.WriteString("alg", "RS256");
      header.WriteString("kid", applicationId);
    });
    _key = key;
  }

  /// <summary>
  /// RS256; header typ JWT, kid = application id; iss enablebanking.com, aud api.enablebanking.com, iat = now,
  /// exp = now + 1 h, both in whole Unix seconds (milliseconds dropped, as the M1 client sends them). BCL only.
  /// </summary>
  public string Create(DateTimeOffset now) {
    long issuedAt = now.ToUnixTimeSeconds();
    long expiresAt = now.Add(_lifetime).ToUnixTimeSeconds();

    string encodedPayload = Base64UrlJson(payload => {
      payload.WriteString("iss", ISSUER);
      payload.WriteString("aud", AUDIENCE);
      payload.WriteNumber("iat", issuedAt);
      payload.WriteNumber("exp", expiresAt);
    });

    string signingInput = $"{_encodedHeader}.{encodedPayload}";

    return $"{signingInput}.{Base64Url.EncodeToString(Sign(Encoding.ASCII.GetBytes(signingInput)))}";
  }

  /// <summary>RSASSA-PKCS1-v1_5 with SHA-256 (RS256), under <see cref="_signing"/>.</summary>
  private byte[] Sign(byte[] data) {
    lock (_signing)
      return _key.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
  }

  /// <summary>A JSON object holding the members <paramref name="writeMembers"/> writes, as UTF-8, base64url-encoded.</summary>
  private static string Base64UrlJson(Action<Utf8JsonWriter> writeMembers) {
    ArrayBufferWriter<byte> json = new();
    using Utf8JsonWriter writer = new(json);

    writer.WriteStartObject();
    writeMembers(writer);
    writer.WriteEndObject();
    writer.Flush();

    return Base64Url.EncodeToString(json.WrittenSpan);
  }
}