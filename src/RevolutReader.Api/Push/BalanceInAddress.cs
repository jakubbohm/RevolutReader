namespace RevolutReader.Api.Push;

/// <summary>The balance in a notification's address (c019 design.md D2, D3), pure.</summary>
public static class BalanceInAddress {
  /// <summary>The fragment's name: <c>#balance=&lt;payload&gt;.&lt;code&gt;</c>.</summary>
  public const string NAME = "balance";

  /// <summary>A push subscription's authentication secret, in bytes (RFC 8291 § 3.2).</summary>
  public const int SECRET_BYTES = 16;

  /// <summary><c>balance=&lt;payload&gt;.&lt;code&gt;</c>, without the <c>#</c>; throws <see cref="ArgumentException"/> for a secret not of 16 bytes.</summary>
  public static string Fragment(PushBalance balance, ReadOnlySpan<byte> deviceSecret) => throw new NotImplementedException();

  /// <summary>The balance's JSON as <c>GET /api/balance</c> writes it, UTF-8, base64url without padding.</summary>
  public static string Payload(PushBalance balance) => throw new NotImplementedException();

  /// <summary>HMAC-SHA-256 of the payload's text under the key HKDF derives from the secret (D3), base64url, 43 characters.</summary>
  public static string CheckCode(string payload, ReadOnlySpan<byte> deviceSecret) => throw new NotImplementedException();
}
