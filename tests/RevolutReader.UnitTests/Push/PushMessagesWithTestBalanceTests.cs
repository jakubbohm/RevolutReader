using System.Text;
using System.Text.Json;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Temporary, for the iPhone test of #113: the owner's message may carry a made-up balance, which the push carries in
/// <c>notification.data.test</c>, never under <c>balance</c> and never with <c>mutable</c>, so iOS shows the notification
/// by itself (a plain declarative push) and no service worker anywhere takes it for the account's balance. A message
/// without it is unchanged (<see cref="PushMessagesTests"/>, <see cref="PushMessagesWithBalanceTests"/>). The JSON is read
/// as a browser reads it, by member and value. The app's address and the amounts are made up.
/// </summary>
public sealed class PushMessagesWithTestBalanceTests {
  /// <summary>The most bytes of JSON a push may carry (c011 design.md D2).</summary>
  private const int MOST_BYTES = 3993;

  private static readonly Uri _appAddress = new("https://app.example.net");

  private static readonly DateTimeOffset _readAt = new(2026, 11, 26, 14, 3, 21, TimeSpan.Zero);

  /// <summary>The owner's test message: a made-up balance, opening the test page with a fragment.</summary>
  private static readonly PushMessage _testMessage = new(
    "Test 1",
    "Vymyšlený zůstatek",
    "/test/notifications#t1",
    Test: new PushBalance(101.01m, _readAt, 25.5m));

  [Test]
  public void A_message_with_a_test_balance_carries_it_in_notification_data_test_with_no_mutable_and_no_balance() {
    JsonElement json = DeclarativeJson(_testMessage);

    JsonElement notification = json.GetProperty("notification");
    json.ShouldSatisfyAllConditions(
      () => MemberNames(json).ShouldBe(["web_push", "notification"], ignoreOrder: true, "no mutable: iOS shows it by itself"),
      () => MemberNames(notification).ShouldBe(["title", "body", "navigate", "data"], ignoreOrder: true),
      () => MemberNames(notification.GetProperty("data")).ShouldBe(["test"], "the made-up balance under test alone, never under balance"));

    JsonElement test = notification.GetProperty("data").GetProperty("test");
    test.ShouldSatisfyAllConditions(
      () => MemberNames(test).ShouldBe(["amount", "readAt", "czkPerEur"], ignoreOrder: true, "the shape of the account's balance"),
      () => test.GetProperty("amount").GetDecimal().ShouldBe(101.01m),
      () => test.GetProperty("readAt").GetDateTimeOffset().ShouldBe(_readAt),
      () => test.GetProperty("czkPerEur").GetDecimal().ShouldBe(25.5m));
  }

  [Test]
  public void The_test_pages_fragment_reaches_navigate() =>
    DeclarativeJson(_testMessage).GetProperty("notification").GetProperty("navigate").GetString()
      .ShouldBe("https://app.example.net/test/notifications#t1");

  /// <summary>The size check counts the made-up balance: 3993 bytes without it fit; the same message with it is refused, naming <c>message</c>.</summary>
  [Test]
  public void The_size_check_counts_the_test_balance() {
    PushMessage frame = new("Test 1", string.Empty, "/test/notifications#t1");
    PushMessage atTheLimit = frame with { Text = new string('x', MOST_BYTES - JsonBytes(frame)) };
    JsonBytes(atTheLimit).ShouldBe(MOST_BYTES, "the test's own message is the size it means to be");

    atTheLimit.ShouldSatisfyAllConditions(
      () => PushMessages.Check(atTheLimit, _appAddress).ShouldBeEmpty("3993 bytes without a test balance fit"),
      () => PushMessages.Check(atTheLimit with { Test = _testMessage.Test }, _appAddress)
        .ShouldHaveSingleItem("the same message with a test balance is too long").Member.ShouldBe("message"));
  }

  private static int JsonBytes(PushMessage message) => Encoding.UTF8.GetByteCount(PushMessages.DeclarativeJson(message, _appAddress));

  private static JsonElement DeclarativeJson(PushMessage message) {
    using JsonDocument document = JsonDocument.Parse(PushMessages.DeclarativeJson(message, _appAddress));

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}