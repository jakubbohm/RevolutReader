using System.Buffers.Binary;
using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// A phone's browser subscribed for pushes (c011 design.md D7), made as a browser makes a subscription: its own P-256 key
/// pair, whose public half is the subscription's <see cref="P256dh"/>, and a 16-byte secret, its <see cref="Auth"/>, both
/// base64url without padding (the form <c>PushSubscription.toJSON()</c> gives); and a push address on the test's
/// <see cref="FakePushService"/> (<see cref="FakePushService.NewDevice"/>). New keys for every device, made up.
/// <para>
/// <see cref="Decrypt"/> reads a push's body as the phone would: RFC 8291's key derivation over RFC 8188's
/// <c>aes128gcm</c>, on .NET's own <see cref="ECDiffieHellman"/>, <see cref="HKDF"/> and <see cref="AesGcm"/>, never with
/// the Web Push library, so the library never checks itself (D1). Written by the test-writer, never by the implementer
/// whose sending it judges (tasks.md 9a.1); its self-test (<c>HarnessSelfTests/TestDeviceSelfTests</c>) reproduces RFC
/// 8291 Appendix A.
/// </para>
/// </summary>
public sealed class TestDevice {
  /// <summary>The secret's size a browser makes (RFC 8291 § 3.2).</summary>
  private const int SECRET_BYTES = 16;

  /// <summary>An uncompressed P-256 point starts with this byte (SEC 1 § 2.3.3).</summary>
  private const byte UNCOMPRESSED_POINT = 0x04;

  /// <summary>An uncompressed P-256 point's size: <c>0x04</c>, X and Y, 32 bytes each.</summary>
  private const int POINT_BYTES = 65;

  private const int COORDINATE_BYTES = 32;

  /// <summary>The <c>aes128gcm</c> header before its key id (RFC 8188 § 2.1): the salt (16 bytes), the record size (4), the key id's length (1).</summary>
  private const int SALT_BYTES = 16;
  private const int RECORD_SIZE_BYTES = 4;
  private const int HEADER_BYTES = SALT_BYTES + RECORD_SIZE_BYTES + 1;

  /// <summary>AES-GCM's authentication tag (RFC 8188 § 2: AEAD_AES_128_GCM).</summary>
  private const int TAG_BYTES = 16;

  private const int KEY_BYTES = 16;
  private const int NONCE_BYTES = 12;

  /// <summary>HKDF-Expand's length for the input keying material (RFC 8291 § 3.4: L = 32).</summary>
  private const int IKM_BYTES = 32;

  /// <summary>The last record's padding delimiter (RFC 8188 § 2; RFC 8291 § 4: a push has one record, so this is it).</summary>
  private const byte LAST_RECORD_DELIMITER = 0x02;

  /// <summary>The scenario's name for the device, for failure messages.</summary>
  public string Name { get; }

  /// <summary>Where its push service receives its pushes: on the fake push service, <c>/push/&lt;device&gt;</c>.</summary>
  public Uri PushAddress { get; }

  /// <summary>The device's public key, the uncompressed P-256 point (65 bytes), base64url without padding.</summary>
  public string P256dh { get; }

  /// <summary>The device's secret (16 bytes), base64url without padding.</summary>
  public string Auth { get; }

  /// <summary>The private half of the device's key pair, the 32-byte scalar, for <see cref="Decrypt"/>.</summary>
  private ReadOnlyMemory<byte> PrivateKey { get; }

  internal TestDevice(string name, Uri pushAddress) : this(name, pushAddress, NewKeys(), RandomNumberGenerator.GetBytes(SECRET_BYTES)) {
  }

  private TestDevice(string name, Uri pushAddress, ECParameters keys, byte[] secret) {
    ArgumentException.ThrowIfNullOrWhiteSpace(name);
    ArgumentNullException.ThrowIfNull(pushAddress);

    Name = name;
    PushAddress = pushAddress;
    P256dh = Base64Url.EncodeToString(UncompressedPoint(keys.Q));
    Auth = Base64Url.EncodeToString(secret);
    PrivateKey = keys.D ?? throw new UnreachableException("A device's keys have their private scalar.");
  }

  /// <summary>
  /// A device with the given keys instead of new ones, for the self-tests (RFC 8291 Appendix A's): the private scalar (32
  /// bytes), the public point (uncompressed, 65 bytes) and the secret (16 bytes).
  /// </summary>
  internal static TestDevice WithKeys(string name, Uri pushAddress, byte[] privateKey, byte[] publicKey, byte[] secret) {
    ArgumentNullException.ThrowIfNull(privateKey);

    ECParameters keys = new() { Curve = ECCurve.NamedCurves.nistP256, D = privateKey, Q = PointOf(publicKey) };

    return new TestDevice(name, pushAddress, keys, secret);
  }

  /// <summary>
  /// The plaintext of a push's <paramref name="body"/>, as UTF-8 text, decrypted with this device's key pair and secret
  /// (RFC 8291, <c>aes128gcm</c>), as a user agent does:
  /// <list type="number">
  /// <item>the header (RFC 8188 § 2.1): the salt, the record size, and the key id, which RFC 8291 § 4 requires to be the
  /// application server's public key, the 65-byte uncompressed point; then exactly one record (RFC 8291 § 4), no longer
  /// than the record size;</item>
  /// <item>the keys (RFC 8291 § 3.4): the ECDH secret of the device's private key and the server's public key; HKDF with
  /// the device's secret as salt and <c>"WebPush: info" 0x00 ua_public as_public</c> as info gives the input keying
  /// material; HKDF with the header's salt gives the content encryption key (<c>"Content-Encoding: aes128gcm" 0x00</c>,
  /// 16 bytes) and the nonce (<c>"Content-Encoding: nonce" 0x00</c>, 12 bytes, the first record's, so unchanged);</item>
  /// <item>AES-128-GCM over the record, its last 16 bytes the tag; then the padding: trailing zeros, before them the
  /// delimiter 0x02 of a last record (RFC 8291 § 4: any other value discards the message).</item>
  /// </list>
  /// A body that does not decrypt, or breaks any of these rules, throws <see cref="CryptographicException"/>; a plaintext
  /// that is not UTF-8 throws <see cref="DecoderFallbackException"/>.
  /// </summary>
  public string Decrypt(ReadOnlyMemory<byte> body) {
    ReadOnlySpan<byte> content = body.Span;

    if (content.Length < HEADER_BYTES)
      throw new CryptographicException("The push is shorter than an aes128gcm header.");

    ReadOnlySpan<byte> salt = content[..SALT_BYTES];
    uint recordSize = BinaryPrimitives.ReadUInt32BigEndian(content.Slice(SALT_BYTES, RECORD_SIZE_BYTES));
    int keyIdLength = content[SALT_BYTES + RECORD_SIZE_BYTES];

    if (keyIdLength != POINT_BYTES || content.Length < HEADER_BYTES + POINT_BYTES)
      throw new CryptographicException("The push's key id is not the server's public key, a 65-byte uncompressed point (RFC 8291 § 4).");

    byte[] serverPublicKey = content.Slice(HEADER_BYTES, POINT_BYTES).ToArray();
    ReadOnlySpan<byte> record = content[(HEADER_BYTES + POINT_BYTES)..];

    if (record.Length <= TAG_BYTES || record.Length > recordSize)
      throw new CryptographicException("The push is not one record of at least a delimiter and a tag, within its record size (RFC 8291 § 4).");

    byte[] devicePublicKey = Base64Url.DecodeFromChars(P256dh);
    byte[] inputKeyingMaterial = InputKeyingMaterial(devicePublicKey, serverPublicKey);
    byte[] pseudoRandomKey = HKDF.Extract(HashAlgorithmName.SHA256, inputKeyingMaterial, salt.ToArray());
    byte[] contentEncryptionKey = HKDF.Expand(HashAlgorithmName.SHA256, pseudoRandomKey, KEY_BYTES, "Content-Encoding: aes128gcm\0"u8.ToArray());
    byte[] nonce = HKDF.Expand(HashAlgorithmName.SHA256, pseudoRandomKey, NONCE_BYTES, "Content-Encoding: nonce\0"u8.ToArray());

    byte[] padded = new byte[record.Length - TAG_BYTES];
    using (AesGcm aes = new(contentEncryptionKey, TAG_BYTES))
      aes.Decrypt(nonce, record[..^TAG_BYTES], record[^TAG_BYTES..], padded);

    int delimiter = padded.AsSpan().LastIndexOfAnyExcept((byte)0);

    if (delimiter < 0 || padded[delimiter] != LAST_RECORD_DELIMITER)
      throw new CryptographicException("The push's padding does not end its one record with the delimiter 0x02 (RFC 8291 § 4).");

    return new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(padded, 0, delimiter);
  }

  /// <summary>A P-256 public point as browsers and the settings write it: uncompressed, <c>0x04</c>, X, Y (65 bytes).</summary>
  internal static byte[] UncompressedPoint(ECPoint point) {
    byte[] x = point.X ?? throw new UnreachableException("An exported P-256 key has its point.");
    byte[] y = point.Y ?? throw new UnreachableException("An exported P-256 key has its point.");

    return [UNCOMPRESSED_POINT, .. x, .. y];
  }

  /// <summary>An uncompressed P-256 point (65 bytes) as .NET's key parameters take it; anything else throws <see cref="CryptographicException"/>.</summary>
  internal static ECPoint PointOf(ReadOnlySpan<byte> uncompressed) =>
    uncompressed.Length == POINT_BYTES && uncompressed[0] == UNCOMPRESSED_POINT
      ? new ECPoint { X = uncompressed.Slice(1, COORDINATE_BYTES).ToArray(), Y = uncompressed.Slice(1 + COORDINATE_BYTES, COORDINATE_BYTES).ToArray() }
      : throw new CryptographicException("Not an uncompressed P-256 point: expected 65 bytes starting with 0x04.");

  /// <summary>
  /// RFC 8291 § 3.4's IKM: HKDF over the ECDH secret of the device's private key and the server's public key, salted with
  /// the device's secret, its info <c>"WebPush: info" 0x00 ua_public as_public</c>, 32 bytes.
  /// </summary>
  private byte[] InputKeyingMaterial(byte[] devicePublicKey, byte[] serverPublicKey) {
    using ECDiffieHellman device = ECDiffieHellman.Create(new ECParameters {
      Curve = ECCurve.NamedCurves.nistP256,
      D = PrivateKey.ToArray(),
      Q = PointOf(devicePublicKey),
    });
    using ECDiffieHellman server = ECDiffieHellman.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = PointOf(serverPublicKey) });
    using ECDiffieHellmanPublicKey serverKey = server.PublicKey;

    byte[] ecdhSecret = device.DeriveRawSecretAgreement(serverKey);
    byte[] keyInfo = [.. "WebPush: info\0"u8, .. devicePublicKey, .. serverPublicKey];

    return HKDF.DeriveKey(HashAlgorithmName.SHA256, ecdhSecret, IKM_BYTES, Base64Url.DecodeFromChars(Auth), keyInfo);
  }

  private static ECParameters NewKeys() {
    using ECDiffieHellman key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);

    return key.ExportParameters(includePrivateParameters: true);
  }
}