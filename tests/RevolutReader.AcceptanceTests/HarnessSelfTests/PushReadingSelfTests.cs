using System.Buffers.Text;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c019 design.md D12; tasks.md 1.2): the push as the phone reads it
/// (<see cref="PushDriver.AsTheDeviceReadsIt(TestDevice, string, ReceivedPush)"/>), handed messages built here, never by
/// the app. The reading finds the balance in <c>navigate</c>'s fragment and whether the phone accepts its check code, and
/// gives <c>navigate</c> without that fragment; it reads <c>mutable</c> and <c>data</c> whenever a push carries them, each
/// on its own, and reports neither when it carries neither, so the scenarios' assertions on them bite. A balance fragment
/// of another shape fails the step. The balance and the secret are design.md D12's, made up: the known-answer vector Node's
/// crypto made, outside both implementations.
/// </summary>
public sealed class PushReadingSelfTests {
  /// <summary>design.md D12's known-answer vector: the fragment for its balance under the secret 0x00 to 0x0f.</summary>
  private const string VECTOR_FRAGMENT =
    "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

  /// <summary>The page the check's notifications open, on a made-up address.</summary>
  private const string PAGE = "https://app.example.net/";

  /// <summary>The vector's read time, <c>2026-11-21T09:14:03+00:00</c>.</summary>
  private static readonly DateTimeOffset _readAt = new(2026, 11, 21, 9, 14, 3, TimeSpan.Zero);

  /// <summary>The vector's balance, as the phone reads it.</summary>
  private static readonly BalanceReading _balance = BalanceReading.Of(45.20m, _readAt, 24.6m);

  [Test]
  public void A_check_notification_is_read_with_its_balance_and_an_accepted_check_code() {
    PushReceived push = Read(AccountNotification($"{PAGE}#{VECTOR_FRAGMENT}"));

    push.ShouldSatisfyAllConditions(
      () => push.Balance.ShouldBe(_balance),
      () => push.CheckCodeAccepted.ShouldBeTrue(),
      () => push.BalanceFragment.ShouldBe(VECTOR_FRAGMENT),
      () => push.Navigate.ShouldBe(PAGE),
      () => push.MarkedForServiceWorker.ShouldBeFalse(),
      () => push.CarriesData.ShouldBeFalse(),
      () => push.Title.ShouldBe("Odešlo 3,80 €"),
      () => push.Text.ShouldBe("Zůstatek 45,20 € (≈ 1 112 Kč)"));
  }

  [Test]
  public void A_push_without_a_balance_fragment_is_read_with_no_balance() {
    PushReceived push = Read(OwnersMessage());

    push.ShouldSatisfyAllConditions(
      () => push.Balance.ShouldBeNull(),
      () => push.CheckCodeAccepted.ShouldBeFalse(),
      () => push.BalanceFragment.ShouldBeNull(),
      () => push.Navigate.ShouldBe(PAGE),
      () => push.MarkedForServiceWorker.ShouldBeFalse(),
      () => push.CarriesData.ShouldBeFalse(),
      () => push.Title.ShouldBe("Ahoj"));
  }

  [Test]
  public void A_fragment_of_another_kind_stays_in_the_address_with_no_balance() {
    JsonObject message = OwnersMessage();
    message["notification"]!.AsObject()["navigate"] = $"{PAGE}#top";

    PushReceived push = Read(message);

    push.Navigate.ShouldBe($"{PAGE}#top");
    push.Balance.ShouldBeNull();
    push.BalanceFragment.ShouldBeNull();
  }

  /// <param name="carries">What the owner's message is given, in c014's places: <c>mutable</c>, <c>data</c>, or both, as c014's check wrote them.</param>
  [Test]
  [Arguments("mutable true")]
  [Arguments("mutable false")]
  [Arguments("data with c014's balance")]
  [Arguments("data null")]
  [Arguments("both, as c014's check wrote them")]
  public void A_push_with_mutable_or_data_is_read_with_them_never_a_failed_step(string carries) {
    JsonObject message = OwnersMessage();
    JsonObject notification = message["notification"]!.AsObject();
    JsonObject c014Balance = new() { ["balance"] = new JsonObject { ["amount"] = 45.20m, ["readAt"] = "2026-11-21T09:14:03+00:00", ["czkPerEur"] = 24.6m } };

    switch (carries) {
      case "mutable true":
        message["mutable"] = true;
        break;
      case "mutable false":
        message["mutable"] = false;
        break;
      case "data with c014's balance":
        notification["data"] = c014Balance;
        break;
      case "data null":
        notification["data"] = null;
        break;
      case "both, as c014's check wrote them":
        message["mutable"] = true;
        notification["data"] = c014Balance;
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(carries), carries, "Not a known case.");
    }

    PushReceived push = Read(message);

    push.MarkedForServiceWorker.ShouldBe(carries.StartsWith("mutable", StringComparison.Ordinal) || carries.StartsWith("both", StringComparison.Ordinal));
    push.CarriesData.ShouldBe(carries.StartsWith("data", StringComparison.Ordinal) || carries.StartsWith("both", StringComparison.Ordinal));
    push.Balance.ShouldBeNull("a balance in data is not the notification's balance any more");
  }

  [Test]
  public void Another_phones_check_code_is_read_but_not_accepted() {
    byte[] otherSecret = [.. Enumerable.Range(0x10, 16).Select(static value => (byte)value)];

    PushReceived push = Read(AccountNotification($"{PAGE}#{VECTOR_FRAGMENT}"), TestDevice.WithSecret("tablet", otherSecret));

    push.Balance.ShouldBe(_balance);
    push.CheckCodeAccepted.ShouldBeFalse();
    push.BalanceFragment.ShouldBe(VECTOR_FRAGMENT);
  }

  /// <param name="variant">How the vector's code is changed.</param>
  [Test]
  [Arguments("its last character changed")]
  [Arguments("one character short")]
  [Arguments("not base64url")]
  [Arguments("empty")]
  public void A_check_code_other_than_the_phones_is_not_accepted(string variant) {
    string code = VectorCode();
    string changed = variant switch {
      "its last character changed" => code[..^1] + (code[^1] == 'A' ? 'Q' : 'A'),
      "one character short" => code[..^1],
      "not base64url" => code[..^1] + "*",
      "empty" => string.Empty,
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };
    string fragment = VECTOR_FRAGMENT[..^code.Length] + changed;

    PushReceived push = Read(AccountNotification($"{PAGE}#{fragment}"));

    push.Balance.ShouldBe(_balance);
    push.CheckCodeAccepted.ShouldBeFalse();
  }

  /// <param name="variant">How the balance fragment differs from what design.md D2 writes.</param>
  [Test]
  [Arguments("no code")]
  [Arguments("a payload that is not base64url")]
  [Arguments("a payload that is not JSON")]
  [Arguments("a payload that is not an object")]
  [Arguments("an amount that is text")]
  [Arguments("no readAt")]
  [Arguments("a readAt that is no date")]
  [Arguments("a member besides the three")]
  public void A_balance_fragment_of_another_shape_fails_the_step(string variant) {
    string code = VectorCode();
    string fragment = variant switch {
      "no code" => $"balance={Payload("""{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}""")}",
      "a payload that is not base64url" => $"balance=not*base64.{code}",
      "a payload that is not JSON" => $"balance={Payload("amount=45.20")}.{code}",
      "a payload that is not an object" => $"balance={Payload("45.20")}.{code}",
      "an amount that is text" => $"balance={Payload("""{"amount":"45.20","readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}""")}.{code}",
      "no readAt" => $"balance={Payload("""{"amount":45.20,"czkPerEur":24.6}""")}.{code}",
      "a readAt that is no date" => $"balance={Payload("""{"amount":45.20,"readAt":"yesterday","czkPerEur":24.6}""")}.{code}",
      "a member besides the three" => $"balance={Payload("""{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6,"currency":"EUR"}""")}.{code}",
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };

    _ = Should.Throw<InvalidOperationException>(() => Read(AccountNotification($"{PAGE}#{fragment}")));
  }

  /// <summary>A check's notification as c019 writes it (design.md D1, D2): no <c>mutable</c>, no <c>data</c>, the balance in <paramref name="navigate"/>.</summary>
  private static JsonObject AccountNotification(string navigate) => new() {
    ["web_push"] = 8030,
    ["notification"] = new JsonObject {
      ["title"] = "Odešlo 3,80 €",
      ["body"] = "Zůstatek 45,20 € (≈ 1 112 Kč)",
      ["navigate"] = navigate,
    },
  };

  /// <summary>An owner's message, as c011 writes it: a title and the page a tap opens, nothing else.</summary>
  private static JsonObject OwnersMessage() => new() {
    ["web_push"] = 8030,
    ["notification"] = new JsonObject { ["title"] = "Ahoj", ["navigate"] = PAGE },
  };

  /// <summary>The vector's check code: what follows the fragment's last <c>.</c>.</summary>
  private static string VectorCode() => VECTOR_FRAGMENT[(VECTOR_FRAGMENT.LastIndexOf('.', StringComparison.Ordinal) + 1)..];

  /// <summary><paramref name="json"/> as a fragment's payload: UTF-8, base64url without padding (design.md D2).</summary>
  private static string Payload(string json) => Base64Url.EncodeToString(Encoding.UTF8.GetBytes(json));

  /// <summary>
  /// <paramref name="message"/> as <paramref name="device"/> reads it (by default the phone whose secret is the vector's,
  /// 0x00 to 0x0f), in a push the fake push service accepted, 24 hours and urgent.
  /// </summary>
  private static PushReceived Read(JsonObject message, TestDevice? device = null) => PushDriver.AsTheDeviceReadsIt(
    device ?? TestDevice.WithSecret("phone", [.. Enumerable.Range(0, 16).Select(static value => (byte)value)]),
    message.ToJsonString(),
    new ReceivedPush(
      "/push/phone",
      new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["TTL"] = "86400", ["Urgency"] = "high" },
      ReadOnlyMemory<byte>.Empty,
      SignedWithServerKey: true,
      HttpStatusCode.Created));
}