using System.Buffers.Text;
using System.Globalization;
using System.Text;
using System.Text.Json;
using RevolutReader.Api.Account;
using RevolutReader.Api.Push;
using Shouldly;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The balance in a notification's address (c019 design.md D2, D3; spec push-sending, account-check): the fragment
/// <c>balance=&lt;payload&gt;.&lt;code&gt;</c>, whose payload is the balance's JSON as <c>GET /api/balance</c> writes it,
/// UTF-8, base64url without padding, and whose code is the 32-byte HMAC-SHA-256 of the payload's text under the key
/// HKDF-SHA-256 derives from the device's push subscription secret (salt <c>"tarjeta-papa"</c>, info
/// <c>"notification balance check code v1"</c>), base64url, 43 characters. The fragment is pinned by design.md D12's
/// known-answer vector, which Node's <c>crypto.hkdfSync</c> and <c>createHmac</c> made once, outside both
/// implementations; the page's own check pins the same vector (<c>src/app/notificationBalance.test.ts</c>), so the two can
/// never drift apart unseen. The secrets and the balances are made up.
/// </summary>
public sealed class BalanceInAddressTests {
  /// <summary>
  /// design.md D12's known-answer vector: the fragment for its balance under the secret 0x00 to 0x0f. Its payload is the
  /// UTF-8 of <c>{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}</c>, the <c>+</c> written as it is.
  /// </summary>
  private const string VECTOR_FRAGMENT =
    "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

  /// <summary>The vector's payload, the fragment's text between <c>balance=</c> and the <c>.</c>.</summary>
  private const string VECTOR_PAYLOAD = "eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ";

  /// <summary>Base64url without padding of 32 bytes: always 43 characters of its alphabet.</summary>
  private const string CODE_SHAPE = "^[A-Za-z0-9_-]{43}$";

  /// <summary>The vector's balance: 45.20 euros, read 2026-11-21T09:14:03+00:00, at 24.6 koruna per euro.</summary>
  private static readonly PushBalance _vectorBalance = new(45.20m, new DateTimeOffset(2026, 11, 21, 9, 14, 3, TimeSpan.Zero), 24.6m);

  /// <summary>The vector's secret, the bytes 0x00 to 0x0f.</summary>
  private static readonly byte[] _vectorSecret = [.. Enumerable.Range(0, 16).Select(static value => (byte)value)];

  /// <summary>Another device's secret, the bytes 0x10 to 0x1f.</summary>
  private static readonly byte[] _otherSecret = [.. Enumerable.Range(16, 16).Select(static value => (byte)value)];

  [Test]
  public void The_fragment_of_the_known_answer_vector_is_exactly_the_pinned_one() =>
    BalanceInAddress.Fragment(_vectorBalance, _vectorSecret).ShouldBe(VECTOR_FRAGMENT);

  /// <summary>
  /// The payload holds the balance's JSON as <c>GET /api/balance</c> writes the same values: its answer,
  /// <see cref="BalanceResponse"/>, written with ASP.NET's JSON options for HTTP answers, which the app leaves at their
  /// defaults. The payload is base64url without padding, and decodes to UTF-8 JSON with the answer's members in its order;
  /// the numbers compare as their JSON text, so a number written as a text or an amount that lost its trailing zeros
  /// fails, and <c>readAt</c> as the ISO 8601 text it holds, so another format fails. How JSON escapes a character of that
  /// text (the answer writes <c>+</c> as <c>+</c>) is not part of it: the known-answer vector pins the payload's bytes.
  /// </summary>
  /// <param name="amount">The amount in euros, as invariant text.</param>
  /// <param name="readAt">The read time, as ISO 8601 text.</param>
  /// <param name="czkPerEur">The rate, as invariant text.</param>
  [Test]
  [Arguments("45.20", "2026-11-21T10:14:03.5123456+01:00", "24.3")] // trailing zeros, ticks, an offset east of UTC
  [Arguments("-5.00", "2026-11-21T09:14:03+00:00", "24.345")] // a negative amount, a whole second, UTC
  [Arguments("1234567.89", "2026-11-20T21:02:44.1-05:00", "24")] // a large amount, a tenth of a second, west of UTC, a whole rate
  public void The_payload_is_the_base64url_of_the_JSON_GET_api_balance_writes_for_the_same_balance(string amount, string readAt, string czkPerEur) {
    decimal euros = decimal.Parse(amount, NumberStyles.Number, CultureInfo.InvariantCulture);
    DateTimeOffset read = DateTimeOffset.Parse(readAt, CultureInfo.InvariantCulture);
    decimal rate = decimal.Parse(czkPerEur, NumberStyles.Number, CultureInfo.InvariantCulture);

    string payload = BalanceInAddress.Payload(new PushBalance(euros, read, rate));

    payload.ShouldMatch("^[A-Za-z0-9_-]+$", "base64url's alphabet, without padding");
    JsonElement inThePayload = Json(payload);
    JsonElement fromTheApi = JsonSerializer.SerializeToElement(new BalanceResponse(euros, read, rate), new HttpJsonOptions().SerializerOptions);

    inThePayload.ShouldSatisfyAllConditions(
      () => MemberNames(inThePayload).ShouldBe(MemberNames(fromTheApi), "the balance answer's members, in its order"),
      () => inThePayload.GetProperty("amount").GetRawText().ShouldBe(fromTheApi.GetProperty("amount").GetRawText(), "amount, as the balance's answer writes it"),
      () => inThePayload.GetProperty("readAt").ValueKind.ShouldBe(JsonValueKind.String),
      () => inThePayload.GetProperty("readAt").GetString().ShouldBe(fromTheApi.GetProperty("readAt").GetString(), "readAt, the same ISO 8601 text"),
      () => inThePayload.GetProperty("czkPerEur").GetRawText().ShouldBe(fromTheApi.GetProperty("czkPerEur").GetRawText(), "czkPerEur, as the balance's answer writes it"));
  }

  [Test]
  public void The_check_code_is_43_base64url_characters_and_another_secret_gives_another_code() {
    string code = BalanceInAddress.CheckCode(VECTOR_PAYLOAD, _vectorSecret);
    string otherCode = BalanceInAddress.CheckCode(VECTOR_PAYLOAD, _otherSecret);

    code.ShouldSatisfyAllConditions(
      () => code.ShouldMatch(CODE_SHAPE, "32 bytes in base64url without padding"),
      () => otherCode.ShouldMatch(CODE_SHAPE, "32 bytes in base64url without padding"),
      () => otherCode.ShouldNotBe(code, "another device's secret gives another code for the same payload"));
  }

  /// <summary>
  /// Both members that take a secret refuse one not of 16 bytes with an <see cref="ArgumentException"/> naming
  /// <c>deviceSecret</c>; the message holds none of the secret's bytes, in hexadecimal, base64 or base64url.
  /// </summary>
  /// <param name="length">The secret's length in bytes.</param>
  [Test]
  [Arguments(0)]
  [Arguments(15)]
  [Arguments(17)]
  [Arguments(32)]
  public void A_secret_not_of_16_bytes_is_refused_with_an_ArgumentException_naming_it_never_its_value(int length) {
    byte[] secret = [.. Enumerable.Range(0, length).Select(static index => (byte)(0xA0 + (index % 16)))];

    ArgumentException fromFragment = Should.Throw<ArgumentException>(() => BalanceInAddress.Fragment(_vectorBalance, secret));
    ArgumentException fromCheckCode = Should.Throw<ArgumentException>(() => BalanceInAddress.CheckCode(VECTOR_PAYLOAD, secret));

    secret.ShouldSatisfyAllConditions(
      () => fromFragment.ParamName.ShouldBe("deviceSecret", "Fragment names the secret"),
      () => NeverItsValue(fromFragment.Message, secret),
      () => fromCheckCode.ParamName.ShouldBe("deviceSecret", "CheckCode names the secret"),
      () => NeverItsValue(fromCheckCode.Message, secret));
  }

  /// <summary>That <paramref name="message"/> holds none of <paramref name="secret"/>'s written forms.</summary>
  private static void NeverItsValue(string message, byte[] secret) {
    if (secret.Length == 0)
      return;

    message.ShouldSatisfyAllConditions(
      () => message.ShouldNotContain(Convert.ToHexString(secret), Case.Insensitive),
      () => message.ShouldNotContain(Convert.ToBase64String(secret)),
      () => message.ShouldNotContain(Base64Url.EncodeToString(secret)));
  }

  /// <summary>The payload's JSON: base64url decoded, read as strict UTF-8, parsed.</summary>
  private static JsonElement Json(string payload) {
    string text = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true).GetString(Base64Url.DecodeFromChars(payload));
    using JsonDocument document = JsonDocument.Parse(text);

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}
