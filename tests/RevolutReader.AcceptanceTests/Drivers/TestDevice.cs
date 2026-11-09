using System.Buffers.Text;
using System.Diagnostics;
using System.Security.Cryptography;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// A phone's browser subscribed for pushes (c011 design.md D7), made as a browser makes a subscription: its own P-256 key
/// pair, whose public half is the subscription's <see cref="P256dh"/>, and a 16-byte secret, its <see cref="Auth"/>, both
/// base64url without padding (the form <c>PushSubscription.toJSON()</c> gives); and a push address on the test's
/// <see cref="FakePushService"/> (<see cref="FakePushService.NewDevice"/>). New keys for every device, made up.
/// <para>
/// <see cref="Decrypt"/> reads a push's body as the phone would: RFC 8291's key derivation over RFC 8188's
/// <c>aes128gcm</c>, on .NET's own <see cref="ECDiffieHellman"/>, <see cref="HKDF"/> and <see cref="AesGcm"/>, never with
/// the Web Push library, so the library never checks itself (D1). Filled in by the wiring group (tasks.md 10.4); until then
/// it throws.
/// </para>
/// </summary>
public sealed class TestDevice {
  /// <summary>The secret's size a browser makes (RFC 8291 § 3.2).</summary>
  private const int SECRET_BYTES = 16;

  /// <summary>An uncompressed P-256 point starts with this byte (SEC 1 § 2.3.3).</summary>
  private const byte UNCOMPRESSED_POINT = 0x04;

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

  internal TestDevice(string name, Uri pushAddress) {
    ArgumentException.ThrowIfNullOrWhiteSpace(name);
    ArgumentNullException.ThrowIfNull(pushAddress);

    using ECDiffieHellman key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    ECParameters parameters = key.ExportParameters(includePrivateParameters: true);

    Name = name;
    PushAddress = pushAddress;
    P256dh = Base64Url.EncodeToString(UncompressedPoint(parameters.Q));
    Auth = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(SECRET_BYTES));
    PrivateKey = parameters.D ?? throw new UnreachableException("A key exported with its private parameters has its scalar.");
  }

  /// <summary>
  /// The plaintext of a push's <paramref name="body"/>, as UTF-8 text, decrypted with this device's key pair and secret
  /// (RFC 8291, <c>aes128gcm</c>); a body that does not decrypt throws <see cref="CryptographicException"/>.
  /// </summary>
  public string Decrypt(ReadOnlyMemory<byte> body) => throw new NotImplementedException();

  /// <summary>A P-256 public point as browsers and the settings write it: uncompressed, <c>0x04</c>, X, Y (65 bytes).</summary>
  internal static byte[] UncompressedPoint(ECPoint point) {
    byte[] x = point.X ?? throw new UnreachableException("An exported P-256 key has its point.");
    byte[] y = point.Y ?? throw new UnreachableException("An exported P-256 key has its point.");

    return [UNCOMPRESSED_POINT, .. x, .. y];
  }
}