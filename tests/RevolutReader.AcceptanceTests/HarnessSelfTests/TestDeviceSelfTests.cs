using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c011 design.md D7, tasks.md 9a.1): the test device's decryption,
/// the only check that the app's pushes follow RFC 8291, reproduces RFC 8291 Appendix A, and refuses a body that is not
/// exactly what was encrypted for the device. The values are the RFC's own example (base64url, whitespace removed), no
/// secret of anyone's.
/// </summary>
public sealed class TestDeviceSelfTests {
  /// <summary>RFC 8291 Appendix A: the plaintext, "When I grow up, I want to be a watermelon".</summary>
  private const string PLAINTEXT = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24";

  /// <summary>RFC 8291 Appendix A: the user agent's private key.</summary>
  private const string RECEIVER_PRIVATE_KEY = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";

  /// <summary>RFC 8291 Appendix A: the user agent's public key.</summary>
  private const string RECEIVER_PUBLIC_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";

  /// <summary>RFC 8291 Appendix A: the authentication secret.</summary>
  private const string AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";

  /// <summary>
  /// RFC 8291 § 5: the push message's body, 144 bytes (the RFC's <c>Content-Length: 145</c> is one too many, as the
  /// bootstrap's probe found). Its header holds the salt, the record size 4096 and the application server's public key.
  /// </summary>
  private const string BODY =
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
    + "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  /// <summary>
  /// c019 design.md D12's known-answer vector: the balance fragment the secret 0x00 to 0x0f makes for the balance
  /// <c>{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}</c>, all made up. Made once with Node's
  /// crypto (<c>crypto.hkdfSync</c>, <c>crypto.createHmac</c>), outside both implementations.
  /// </summary>
  private const string VECTOR_FRAGMENT =
    "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

  /// <summary>Where RFC 8291 § 5's example sends it.</summary>
  private static readonly Uri _pushAddress = new("https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV");

  [Test]
  public void The_test_device_reproduces_RFC_8291_Appendix_A() {
    string plaintext = Encoding.ASCII.GetString(Base64Url.DecodeFromChars(PLAINTEXT));

    TheReceiver().Decrypt(Base64Url.DecodeFromChars(BODY)).ShouldBe(plaintext);
    plaintext.ShouldBe("When I grow up, I want to be a watermelon", "the RFC's plaintext, as its § 5 says");
  }

  /// <param name="changed">Where one bit of the RFC's body is flipped: the header's salt, the encrypted text, or the tag.</param>
  [Test]
  [Arguments("a byte of the salt")]
  [Arguments("a byte of the encrypted text")]
  [Arguments("the last byte of the tag")]
  public void A_body_changed_in_one_byte_does_not_decrypt(string changed) {
    byte[] body = Base64Url.DecodeFromChars(BODY);
    int index = changed switch {
      "a byte of the salt" => 0,
      "a byte of the encrypted text" => 86, // after the 86-byte header (RFC 8291 § 4)
      "the last byte of the tag" => body.Length - 1,
      _ => throw new ArgumentOutOfRangeException(nameof(changed), changed, "Not a known case."),
    };
    body[index] ^= 0x01;

    _ = Should.Throw<CryptographicException>(() => TheReceiver().Decrypt(body));
  }

  /// <param name="device">A device that is not the one the body was encrypted for: another key pair, or the same keys with another secret.</param>
  [Test]
  [Arguments("a device with keys of its own")]
  [Arguments("the receiver's keys with another secret")]
  public void A_push_for_another_device_does_not_decrypt(string device) {
    TestDevice another = device switch {
      "a device with keys of its own" => new TestDevice("another phone", _pushAddress),
      "the receiver's keys with another secret" => TestDevice.WithKeys(
        "the receiver with another secret",
        _pushAddress,
        Base64Url.DecodeFromChars(RECEIVER_PRIVATE_KEY),
        Base64Url.DecodeFromChars(RECEIVER_PUBLIC_KEY),
        RandomNumberGenerator.GetBytes(16)),
      _ => throw new ArgumentOutOfRangeException(nameof(device), device, "Not a known case."),
    };

    _ = Should.Throw<CryptographicException>(() => another.Decrypt(Base64Url.DecodeFromChars(BODY)));
  }

  // c019 design.md D3, D12: the check code of a notification's balance.

  [Test]
  public void The_test_device_accepts_the_check_code_of_the_known_answer_vector() {
    TestDevice.WithSecret("the vector's phone", VectorSecret()).Accepts(VECTOR_FRAGMENT).ShouldBeTrue();
  }

  /// <param name="changed">How the vector's fragment, or the device checking it, differs from the vector.</param>
  [Test]
  [Arguments("a device with another secret")]
  [Arguments("one character of the payload changed")]
  [Arguments("one character of the code changed")]
  [Arguments("the code one character short")]
  [Arguments("no code")]
  [Arguments("another fragment name")]
  public void The_test_device_accepts_no_other_check_code(string changed) {
    TestDevice phone = TestDevice.WithSecret("the vector's phone", VectorSecret());
    int separator = VECTOR_FRAGMENT.LastIndexOf('.', StringComparison.Ordinal);
    string payload = VECTOR_FRAGMENT[..separator];
    string code = VECTOR_FRAGMENT[(separator + 1)..];

    (TestDevice device, string fragment) = changed switch {
      "a device with another secret" => (TestDevice.WithSecret("another phone", [.. VectorSecret().Select(static value => (byte)(value ^ 0xff))]), VECTOR_FRAGMENT),
      "one character of the payload changed" => (phone, $"{payload[..^1]}{(payload[^1] == 'Q' ? 'R' : 'Q')}.{code}"),
      "one character of the code changed" => (phone, $"{payload}.{code[..^1]}{(code[^1] == 'A' ? 'Q' : 'A')}"),
      "the code one character short" => (phone, $"{payload}.{code[..^1]}"),
      "no code" => (phone, payload),
      "another fragment name" => (phone, $"saldo={VECTOR_FRAGMENT["balance=".Length..]}"),
      _ => throw new ArgumentOutOfRangeException(nameof(changed), changed, "Not a known case."),
    };

    device.Accepts(fragment).ShouldBeFalse();
  }

  /// <summary>design.md D12's made-up secret: the 16 bytes 0x00 to 0x0f.</summary>
  private static byte[] VectorSecret() => [.. Enumerable.Range(0, 16).Select(static value => (byte)value)];

  /// <summary>The RFC's user agent, as a test device.</summary>
  private static TestDevice TheReceiver() => TestDevice.WithKeys(
    "RFC 8291 Appendix A's user agent",
    _pushAddress,
    Base64Url.DecodeFromChars(RECEIVER_PRIVATE_KEY),
    Base64Url.DecodeFromChars(RECEIVER_PUBLIC_KEY),
    Base64Url.DecodeFromChars(AUTH_SECRET));
}