using System.Net;
using System.Text.Json.Nodes;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c014 design.md D14, D16; tasks.md 1.1): the push as the phone reads
/// it (<see cref="PushDriver.AsTheDeviceReadsIt(string, string, ReceivedPush)"/>), handed messages built here, never by the
/// app. The reading finds <c>mutable</c> and the balance when a push carries them, each on its own, and reports neither
/// when it carries neither, so the scenarios' assertions on them bite, the owner's message's included (spec push-sending);
/// a push that carries either other than where D14 places them, or in another shape, fails the step. The values are made
/// up, those of design.md D14's example.
/// </summary>
public sealed class PushReadingSelfTests {
  /// <summary>The read time in the example's balance, an hour east of UTC, so reading it as an instant shows.</summary>
  private const string READ_AT = "2026-11-21T10:14:03.5123456+01:00";

  /// <summary>The same instant in UTC.</summary>
  private static readonly DateTimeOffset _readAt = new DateTimeOffset(2026, 11, 21, 9, 14, 3, TimeSpan.Zero).AddTicks(5_123_456);

  [Test]
  public void A_push_marked_for_the_service_worker_with_a_balance_is_read_with_both() {
    PushReceived push = Read(AccountNotification());

    push.ShouldSatisfyAllConditions(
      () => push.MarkedForServiceWorker.ShouldBeTrue(),
      () => push.Balance.ShouldBe(BalanceReading.Of(45.20m, _readAt, 24.3m)),
      () => push.Title.ShouldBe("Odešlo 3,80 €"),
      () => push.Text.ShouldBe("Zůstatek 45,20 € (≈ 1 098 Kč)"),
      () => push.Navigate.ShouldBe("https://app.example.net/"));
  }

  [Test]
  public void A_push_without_them_is_read_with_neither() {
    PushReceived push = Read(OwnersMessage());

    push.ShouldSatisfyAllConditions(
      () => push.MarkedForServiceWorker.ShouldBeFalse(),
      () => push.Balance.ShouldBeNull(),
      () => push.Title.ShouldBe("Ahoj"));
  }

  /// <param name="carries">Which of the two members the owner's message is given on its own.</param>
  [Test]
  [Arguments("only mutable")]
  [Arguments("only the balance")]
  public void A_push_with_one_of_them_is_read_with_that_one_alone(string carries) {
    JsonObject message = OwnersMessage();

    switch (carries) {
      case "only mutable":
        message["mutable"] = true;
        break;
      case "only the balance":
        message["notification"]!.AsObject()["data"] = new JsonObject { ["balance"] = Balance() };
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(carries), carries, "Not a known case.");
    }

    PushReceived push = Read(message);

    push.MarkedForServiceWorker.ShouldBe(carries == "only mutable");
    push.Balance.ShouldBe(carries == "only the balance" ? BalanceReading.Of(45.20m, _readAt, 24.3m) : null);
  }

  /// <param name="variant">How an account notification's two members differ from what design.md D14 places and the app writes.</param>
  [Test]
  [Arguments("mutable false")]
  [Arguments("mutable as text")]
  [Arguments("mutable in the notification")]
  [Arguments("data at the top level")]
  [Arguments("data without a balance")]
  [Arguments("data with a member besides the balance")]
  [Arguments("a balance that is not an object")]
  [Arguments("a balance whose amount is text")]
  [Arguments("a balance without readAt")]
  [Arguments("a balance whose readAt is no date")]
  [Arguments("a balance with a member besides the three")]
  public void A_push_carrying_them_other_than_as_D14_places_them_fails_the_step(string variant) {
    JsonObject message = AccountNotification();
    JsonObject notification = message["notification"]!.AsObject();
    JsonObject data = notification["data"]!.AsObject();
    JsonObject balance = data["balance"]!.AsObject();

    switch (variant) {
      case "mutable false":
        message["mutable"] = false;
        break;
      case "mutable as text":
        message["mutable"] = "true";
        break;
      case "mutable in the notification":
        _ = message.Remove("mutable");
        notification["mutable"] = true;
        break;
      case "data at the top level":
        _ = notification.Remove("data");
        message["data"] = new JsonObject { ["balance"] = Balance() };
        break;
      case "data without a balance":
        _ = data.Remove("balance");
        break;
      case "data with a member besides the balance":
        data["account"] = "made-up";
        break;
      case "a balance that is not an object":
        data["balance"] = 45.20m;
        break;
      case "a balance whose amount is text":
        balance["amount"] = "45.20";
        break;
      case "a balance without readAt":
        _ = balance.Remove("readAt");
        break;
      case "a balance whose readAt is no date":
        balance["readAt"] = "yesterday";
        break;
      case "a balance with a member besides the three":
        balance["currency"] = "EUR";
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case.");
    }

    _ = Should.Throw<InvalidOperationException>(() => Read(message));
  }

  /// <summary>A check's notification as design.md D14 writes it: <c>mutable</c> at the top level, the balance in <c>notification.data</c>.</summary>
  private static JsonObject AccountNotification() => new() {
    ["web_push"] = 8030,
    ["notification"] = new JsonObject {
      ["title"] = "Odešlo 3,80 €",
      ["body"] = "Zůstatek 45,20 € (≈ 1 098 Kč)",
      ["navigate"] = "https://app.example.net/",
      ["data"] = new JsonObject { ["balance"] = Balance() },
    },
    ["mutable"] = true,
  };

  /// <summary>The balance as <c>GET /api/balance</c> answers it: <c>amount</c> and <c>czkPerEur</c> numbers, <c>readAt</c> an ISO 8601 date and time.</summary>
  private static JsonObject Balance() => new() { ["amount"] = 45.20m, ["readAt"] = READ_AT, ["czkPerEur"] = 24.3m };

  /// <summary>An owner's message, as c011 writes it: a title and the page a tap opens, nothing else.</summary>
  private static JsonObject OwnersMessage() => new() {
    ["web_push"] = 8030,
    ["notification"] = new JsonObject { ["title"] = "Ahoj", ["navigate"] = "https://app.example.net/" },
  };

  /// <summary><paramref name="message"/> as the phone reads it, in a push the fake push service accepted, 24 hours and urgent.</summary>
  private static PushReceived Read(JsonObject message) => PushDriver.AsTheDeviceReadsIt(
    "phone",
    message.ToJsonString(),
    new ReceivedPush(
      "/push/phone",
      new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["TTL"] = "86400", ["Urgency"] = "high" },
      ReadOnlyMemory<byte>.Empty,
      SignedWithServerKey: true,
      HttpStatusCode.Created));
}