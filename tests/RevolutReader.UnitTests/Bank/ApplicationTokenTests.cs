using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// Every request to Enable Banking carries a JWT signed by the application (c004 design.md § Context, § Rule ownership;
/// the API reference § Authentication, as the M1 spike's <c>eb-client.ps1</c> signs it): typed JWT, RS256, the
/// application id as the key id, issued by <c>enablebanking.com</c> for <c>api.enablebanking.com</c>, valid for one hour
/// from now, its times in whole Unix seconds. The token is decoded here with the BCL only; the key is generated in the
/// test.
/// </summary>
public sealed class ApplicationTokenTests {
  private const string MADE_UP_APPLICATION_ID = "0c004000-0000-4000-8000-00000000a001";

  /// <summary>10:30 in Prague (CET, +01:00), so 09:30 UTC: the offset must not move the token's times.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 6, 10, 30, 0, TimeSpan.FromHours(1));

  [Test]
  public void The_token_is_signed_with_RS256_and_names_the_application_id_as_its_key_id() {
    using RSA key = RSA.Create(2048);

    DecodedToken token = Decode(new ApplicationToken(MADE_UP_APPLICATION_ID, key).Create(_now));

    StringMember(token.Header, "typ").ShouldBe("JWT");
    StringMember(token.Header, "alg").ShouldBe("RS256");
    StringMember(token.Header, "kid").ShouldBe(MADE_UP_APPLICATION_ID);
  }

  [Test]
  public void The_token_is_issued_by_enablebanking_com_for_api_enablebanking_com() {
    using RSA key = RSA.Create(2048);

    DecodedToken token = Decode(new ApplicationToken(MADE_UP_APPLICATION_ID, key).Create(_now));

    StringMember(token.Payload, "iss").ShouldBe("enablebanking.com");
    StringMember(token.Payload, "aud").ShouldBe("api.enablebanking.com");
  }

  /// <param name="millisecondsAfterHalfPastTen">How long after 10:30:00 +01:00 (09:30:00 UTC) the token is created.</param>
  /// <param name="nowInUnixSeconds">That moment in whole seconds since 1970-01-01T00:00:00Z, the milliseconds dropped.</param>
  [Test]
  [Arguments(0, 1_793_957_400L)]
  [Arguments(15_482, 1_793_957_415L)]
  public void The_token_is_issued_now_and_expires_one_hour_later(int millisecondsAfterHalfPastTen, long nowInUnixSeconds) {
    using RSA key = RSA.Create(2048);

    DecodedToken token = Decode(new ApplicationToken(MADE_UP_APPLICATION_ID, key).Create(_now.AddMilliseconds(millisecondsAfterHalfPastTen)));

    NumberMember(token.Payload, "iat").ShouldBe(nowInUnixSeconds);
    NumberMember(token.Payload, "exp").ShouldBe(nowInUnixSeconds + 3600);
  }

  [Test]
  public void The_tokens_signature_verifies_with_the_applications_public_key() {
    using RSA key = RSA.Create(2048);
    using RSA publicKey = RSA.Create();
    publicKey.ImportSubjectPublicKeyInfo(key.ExportSubjectPublicKeyInfo(), out _);

    DecodedToken token = Decode(new ApplicationToken(MADE_UP_APPLICATION_ID, key).Create(_now));

    publicKey.VerifyData(Encoding.ASCII.GetBytes(token.SigningInput), token.Signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
      .ShouldBeTrue("the signature over header.payload, RS256 (RSASSA-PKCS1-v1_5 with SHA-256)");
  }

  /// <summary>A compact JWT taken apart: <c>base64url(header).base64url(payload).base64url(signature)</c>.</summary>
  private static DecodedToken Decode(string token) {
    string[] parts = token.Split('.');

    parts.Length.ShouldBe(3, "a compact JWT: header, payload and signature");

    return new(Json(parts[0]), Json(parts[1]), $"{parts[0]}.{parts[1]}", Base64Url.DecodeFromChars(parts[2]));
  }

  private static JsonElement Json(string part) {
    using JsonDocument document = JsonDocument.Parse(Base64Url.DecodeFromChars(part));

    document.RootElement.ValueKind.ShouldBe(JsonValueKind.Object);

    return document.RootElement.Clone();
  }

  /// <summary>The member's text when it is a JSON string; otherwise its raw JSON, so a wrong shape shows in the failure.</summary>
  private static string? StringMember(JsonElement element, string name) =>
    !element.TryGetProperty(name, out JsonElement member) ? null
    : member.ValueKind == JsonValueKind.String ? member.GetString()
    : member.GetRawText();

  /// <summary>The member's value when it is a whole JSON number; otherwise <see langword="null"/>.</summary>
  private static long? NumberMember(JsonElement element, string name) =>
    element.TryGetProperty(name, out JsonElement member) && member.ValueKind == JsonValueKind.Number && member.TryGetInt64(out long value) ? value : null;

  private sealed record DecodedToken(JsonElement Header, JsonElement Payload, string SigningInput, byte[] Signature);
}