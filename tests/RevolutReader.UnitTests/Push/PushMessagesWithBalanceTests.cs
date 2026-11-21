using System.Globalization;
using System.Text;
using System.Text.Json;
using RevolutReader.Api.Account;
using RevolutReader.Api.Push;
using Shouldly;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// A notification about the account carries the balance (c014 design.md D14, N2; spec push-sending): a message with a
/// balance becomes Declarative Web Push JSON with <c>"mutable": true</c> at its top level, where the parser reads it, and
/// <c>notification.data.balance</c> holding <c>amount</c>, <c>readAt</c> and <c>czkPerEur</c>; each value is written as
/// <c>GET /api/balance</c> writes the same value; and the size check counts the two members, while the check's own
/// notification stays far inside the 3993 bytes. C8a's tests of a message without a balance
/// (<see cref="PushMessagesTests"/>) are unchanged. The JSON is read as a browser reads it, by member and value; for
/// 24.2, each value's own text. The app's address is made up, an https origin of a reserved domain; the amounts are
/// made up.
/// </summary>
public sealed class PushMessagesWithBalanceTests {
  /// <summary>The most bytes of JSON a push may carry (c011 design.md D2).</summary>
  private const int MOST_BYTES = 3993;

  private static readonly Uri _appAddress = new("https://app.example.net");

  /// <summary>A read time to the tick, an hour east of UTC.</summary>
  private static readonly DateTimeOffset _readAt = new DateTimeOffset(2026, 11, 21, 10, 14, 3, TimeSpan.FromHours(1)).AddTicks(5_123_456);

  /// <summary>The check's notification for a fall to 45.20, as design.md D14's example: its title, text and balance.</summary>
  private static readonly PushMessage _accountNotification = new(
    "Odešlo 3,80\u00A0€",
    "Zůstatek 45,20\u00A0€ (≈\u00A01\u00A0098\u00A0Kč)",
    "/",
    new PushBalance(45.20m, _readAt, 24.3m));

  [Test]
  public void A_message_with_a_balance_becomes_JSON_with_mutable_true_at_the_top_level_and_notification_data_balance_holding_amount_readAt_and_czkPerEur() {
    JsonElement json = DeclarativeJson(_accountNotification);

    JsonElement notification = json.GetProperty("notification");
    json.ShouldSatisfyAllConditions(
      () => MemberNames(json).ShouldBe(["web_push", "notification", "mutable"], ignoreOrder: true, "mutable at the message's top level, beside web_push and notification"),
      () => json.GetProperty("mutable").ValueKind.ShouldBe(JsonValueKind.True, "mutable is the JSON value true"),
      () => MemberNames(notification).ShouldBe(["title", "body", "navigate", "data"], ignoreOrder: true, "data in the notification, beside its title, text and page"),
      () => MemberNames(notification.GetProperty("data")).ShouldBe(["balance"], "the data holds the balance alone"));

    JsonElement balance = notification.GetProperty("data").GetProperty("balance");
    balance.ShouldSatisfyAllConditions(
      () => MemberNames(balance).ShouldBe(["amount", "readAt", "czkPerEur"], ignoreOrder: true),
      () => balance.GetProperty("amount").ValueKind.ShouldBe(JsonValueKind.Number, "amount is a JSON number"),
      () => balance.GetProperty("amount").GetDecimal().ShouldBe(45.20m),
      () => balance.GetProperty("readAt").GetDateTimeOffset().ShouldBe(_readAt, "readAt is the read time, as an ISO 8601 text"),
      () => balance.GetProperty("czkPerEur").ValueKind.ShouldBe(JsonValueKind.Number, "czkPerEur is a JSON number"),
      () => balance.GetProperty("czkPerEur").GetDecimal().ShouldBe(24.3m));
  }

  /// <summary>
  /// Each value of the push's balance is written as <c>GET /api/balance</c> writes the same values (D14): its answer,
  /// <see cref="BalanceResponse"/>, written with ASP.NET's JSON options for HTTP answers, which the app leaves at their
  /// defaults (it configures none). The numbers compare as their JSON text, so a number written as a text, or an amount
  /// that lost its trailing zeros (a <see cref="double"/>'s 45.2 for 45.20), fails; <c>readAt</c> compares as the ISO 8601
  /// text it holds, so another format (<c>Z</c> for <c>+00:00</c>, milliseconds for ticks, fractions of a second written
  /// out as zeros) fails. How JSON escapes a character of that text, <c>+</c> for one, is not part of it.
  /// </summary>
  /// <param name="amount">The amount in euros, as invariant text.</param>
  /// <param name="readAt">The read time, as ISO 8601 text.</param>
  /// <param name="czkPerEur">The rate, as invariant text.</param>
  [Test]
  [Arguments("45.20", "2026-11-21T10:14:03.5123456+01:00", "24.3")] // trailing zeros, ticks, an offset east of UTC
  [Arguments("-5.00", "2026-11-21T09:14:03+00:00", "24.345")] // a negative amount, a whole second, UTC
  [Arguments("1234567.89", "2026-11-20T21:02:44.1-05:00", "24")] // a large amount, a tenth of a second, west of UTC, a whole rate
  public void The_pushs_balance_is_written_exactly_as_GET_api_balance_writes_the_same_values(string amount, string readAt, string czkPerEur) {
    decimal euros = decimal.Parse(amount, NumberStyles.Number, CultureInfo.InvariantCulture);
    DateTimeOffset read = DateTimeOffset.Parse(readAt, CultureInfo.InvariantCulture);
    decimal rate = decimal.Parse(czkPerEur, NumberStyles.Number, CultureInfo.InvariantCulture);

    JsonElement inThePush = DeclarativeJson(_accountNotification with { Balance = new PushBalance(euros, read, rate) })
      .GetProperty("notification").GetProperty("data").GetProperty("balance");
    JsonElement fromTheApi = JsonSerializer.SerializeToElement(new BalanceResponse(euros, read, rate), new HttpJsonOptions().SerializerOptions);

    inThePush.ShouldSatisfyAllConditions(
      () => inThePush.GetProperty("amount").GetRawText().ShouldBe(fromTheApi.GetProperty("amount").GetRawText(), "amount, as the balance's answer writes it"),
      () => inThePush.GetProperty("readAt").ValueKind.ShouldBe(JsonValueKind.String),
      () => inThePush.GetProperty("readAt").GetString().ShouldBe(fromTheApi.GetProperty("readAt").GetString(), "readAt, the same ISO 8601 text"),
      () => inThePush.GetProperty("czkPerEur").GetRawText().ShouldBe(fromTheApi.GetProperty("czkPerEur").GetRawText(), "czkPerEur, as the balance's answer writes it"));
  }

  /// <summary>
  /// The check's own notification, with its balance, fits a push. And the size check counts the two members: a message
  /// whose JSON without a balance is exactly 3993 bytes, which fits (c011's own test), is refused, naming <c>message</c>,
  /// once it carries a balance.
  /// </summary>
  [Test]
  public void A_message_with_a_balance_still_fits_the_3993_bytes_and_the_size_check_counts_the_two_members() {
    PushMessage atTheLimitWithoutBalance = AsciiMessageOfBytes(MOST_BYTES);

    atTheLimitWithoutBalance.ShouldSatisfyAllConditions(
      () => PushMessages.Check(_accountNotification, _appAddress).ShouldBeEmpty("the check's notification, with its balance, fits a push"),
      () => PushMessages.Check(atTheLimitWithoutBalance, _appAddress).ShouldBeEmpty("3993 bytes without a balance fit"),
      () => PushMessages.Check(atTheLimitWithoutBalance with { Balance = _accountNotification.Balance }, _appAddress)
        .ShouldHaveSingleItem("the same message with a balance is too long").Member.ShouldBe("message"));
  }

  /// <summary>
  /// A message with no balance whose JSON is exactly <paramref name="bytes"/> bytes, padded with ASCII letters in its text,
  /// measured on <see cref="PushMessages.DeclarativeJson"/>, as c011's size tests build theirs.
  /// </summary>
  private static PushMessage AsciiMessageOfBytes(int bytes) {
    PushMessage frame = new("Zůstatek se změnil", string.Empty, "/transakce");
    PushMessage message = frame with { Text = new string('x', bytes - JsonBytes(frame)) };

    JsonBytes(message).ShouldBe(bytes, "the test's own message is the size it means to be");

    return message;
  }

  /// <summary>The UTF-8 bytes of the message's JSON on the made-up app address.</summary>
  private static int JsonBytes(PushMessage message) => Encoding.UTF8.GetByteCount(PushMessages.DeclarativeJson(message, _appAddress));

  /// <summary>The message's JSON for the made-up app address, parsed as a browser reads it.</summary>
  private static JsonElement DeclarativeJson(PushMessage message) {
    using JsonDocument document = JsonDocument.Parse(PushMessages.DeclarativeJson(message, _appAddress));

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}