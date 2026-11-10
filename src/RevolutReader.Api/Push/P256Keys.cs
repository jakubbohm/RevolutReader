using System.Security.Cryptography;

namespace RevolutReader.Api.Push;

/// <summary>
/// P-256 keys as push writes them, in base64url without padding (<see cref="StrictBase64Url"/>): a public key as the
/// 65-byte uncompressed point, the server's VAPID public key (c011 design.md D5) and a device's <c>p256dh</c> (D9), and
/// the VAPID private key as the 32-byte scalar (D5). A key is taken only when the platform imports it, so a public key
/// is a point on the curve.
/// </summary>
internal static class P256Keys {
  /// <summary>The uncompressed point's length: 0x04, then X and Y, 32 bytes each (SEC 1, § 2.3.3).</summary>
  private const int POINT_BYTES = 65;

  private const byte UNCOMPRESSED_POINT = 0x04;

  private const int COORDINATE_BYTES = 32;

  private const int SCALAR_BYTES = 32;

  /// <summary>The key <paramref name="text"/> holds when it is the 65-byte uncompressed point of P-256, on the curve, else null.</summary>
  public static ECDsa? ImportPublicKey(string? text) {
    if (StrictBase64Url.Decode(text) is not { Length: POINT_BYTES } point || point[0] != UNCOMPRESSED_POINT)
      return null;

    return Import(new ECParameters {
      Curve = ECCurve.NamedCurves.nistP256,
      Q = new ECPoint { X = point[1..(1 + COORDINATE_BYTES)], Y = point[(1 + COORDINATE_BYTES)..] },
    });
  }

  /// <summary>Whether <paramref name="text"/> is the 65-byte uncompressed point of P-256, on the curve.</summary>
  public static bool IsPublicKey(string? text) {
    using ECDsa? key = ImportPublicKey(text);

    return key is not null;
  }

  /// <summary>
  /// The key <paramref name="text"/> holds when it is a 32-byte scalar the platform takes as a P-256 private key, else
  /// null. Imported without a public point, which the platform derives from the scalar.
  /// </summary>
  public static ECDsa? ImportPrivateKey(string? text) =>
    StrictBase64Url.Decode(text) is { Length: SCALAR_BYTES } scalar
      ? Import(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, D = scalar })
      : null;

  /// <summary>
  /// The platform's key for <paramref name="parameters"/>, or null when it refuses them. The platforms refuse differently
  /// (probed 2026-11-09): Windows (CNG) refuses a point off the curve with <see cref="PlatformNotSupportedException"/> and a
  /// scalar out of range with <see cref="CryptographicException"/>; Linux (OpenSSL) refuses a point off the curve with
  /// <see cref="CryptographicException"/> and takes any 32-byte scalar, which only the VAPID pair check then refuses.
  /// </summary>
  private static ECDsa? Import(ECParameters parameters) {
    try {
      return ECDsa.Create(parameters);
    }
    catch (CryptographicException) {
      return null;
    }
    catch (PlatformNotSupportedException) {
      return null;
    }
  }
}