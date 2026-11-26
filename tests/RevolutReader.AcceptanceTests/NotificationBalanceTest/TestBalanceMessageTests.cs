using System.Text.Json;
using System.Text.Json.Nodes;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.NotificationBalanceTest;

/// <summary>
/// Temporary, for the iPhone test of #113, reverted with it: the owner's message (<c>POST /api/push/messages</c>) may carry
/// a made-up balance as <c>test</c>, which reaches the phone in the notification's <c>data</c> under <c>test</c>, never
/// under <c>balance</c> and never with <c>mutable</c>, so iOS shows it by itself and no service worker takes it for the
/// account's balance or reports its arrival. A message without it sends exactly the push it sent before. No scenario
/// claims these tests: nothing in the specs changes. The pushes are read as the JSON they decrypt to, member by member,
/// as a browser reads them. The amounts are made up.
/// </summary>
public sealed class TestBalanceMessageTests : AcceptanceTest {
  private const string TEST_PAGE = "/test/notifications#t1";

  [Test]
  public async Task A_message_with_a_test_balance_reaches_the_phone_with_it_under_data_test_never_under_balance_and_never_mutable() {
    TestDevice phone = await LuciesRegisteredPhone();
    JsonObject test = new() { ["amount"] = 101.01m, ["readAt"] = "2026-11-26T14:03:21+00:00", ["czkPerEur"] = 25.5m };

    (await PushDriver.SendMessageWithTestBalance(Visitor.Lucie.Email, "Test 1", TEST_PAGE, test))
      .ShouldBe(MessageAnswer.Counts(delivered: 1, failed: 0, removed: 0));

    JsonElement push = Parsed(PushDriver.PushContentsReceivedFor(phone).ShouldHaveSingleItem());
    JsonElement notification = push.GetProperty("notification");
    JsonElement data = notification.GetProperty("data");
    push.ShouldSatisfyAllConditions(
      () => MemberNames(push).ShouldBe(["web_push", "notification"], ignoreOrder: true, "no mutable: iOS shows it by itself"),
      () => MemberNames(notification).ShouldBe(["title", "navigate", "data"], ignoreOrder: true),
      () => notification.GetProperty("title").GetString().ShouldBe("Test 1"),
      () => new Uri(notification.GetProperty("navigate").GetString()!).PathAndQuery.ShouldBe("/test/notifications"),
      () => new Uri(notification.GetProperty("navigate").GetString()!).Fragment.ShouldBe("#t1", "the fragment reaches navigate"),
      () => MemberNames(data).ShouldBe(["test"], "under test alone, never under balance"));

    JsonElement sent = data.GetProperty("test");
    sent.ShouldSatisfyAllConditions(
      () => MemberNames(sent).ShouldBe(["amount", "readAt", "czkPerEur"], ignoreOrder: true),
      () => sent.GetProperty("amount").GetDecimal().ShouldBe(101.01m),
      () => sent.GetProperty("readAt").GetDateTimeOffset().ShouldBe(new DateTimeOffset(2026, 11, 26, 14, 3, 21, TimeSpan.Zero)),
      () => sent.GetProperty("czkPerEur").GetDecimal().ShouldBe(25.5m));
  }

  [Test]
  public async Task A_message_without_a_test_balance_sends_the_push_it_sent_before() {
    TestDevice phone = await LuciesRegisteredPhone();

    (await PushDriver.SendMessage(Visitor.Lucie.Email, "Ahoj", "Zkušební zpráva", "/"))
      .ShouldBe(MessageAnswer.Counts(delivered: 1, failed: 0, removed: 0));

    JsonElement push = Parsed(PushDriver.PushContentsReceivedFor(phone).ShouldHaveSingleItem());
    push.ShouldSatisfyAllConditions(
      () => MemberNames(push).ShouldBe(["web_push", "notification"], ignoreOrder: true),
      () => MemberNames(push.GetProperty("notification")).ShouldBe(["title", "body", "navigate"], ignoreOrder: true, "no data"));
  }

  /// <param name="test">The request's <c>test</c> member, as JSON text.</param>
  [Test]
  [Arguments("""{ "amount": 101.01, "readAt": "2026-11-26T14:03:21+00:00" }""")] // no rate
  [Arguments("""{ "amount": 101.01, "czkPerEur": 25.5 }""")] // no read time
  [Arguments("""{ "readAt": "2026-11-26T14:03:21+00:00", "czkPerEur": 25.5 }""")] // no amount
  [Arguments("""{ "amount": null, "readAt": "2026-11-26T14:03:21+00:00", "czkPerEur": 25.5 }""")] // an amount of null
  [Arguments("""{ "amount": 101.01, "readAt": "yesterday", "czkPerEur": 25.5 }""")] // a read time that is no date
  [Arguments("\"101.01\"")] // not an object
  public async Task A_test_balance_that_is_not_a_whole_balance_refuses_the_message_as_an_unreadable_body_and_sends_nothing(string test) {
    TestDevice phone = await LuciesRegisteredPhone();

    (await PushDriver.SendMessageWithTestBalance(Visitor.Lucie.Email, "Test 1", TEST_PAGE, JsonNode.Parse(test)!))
      .ShouldBe(MessageAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.Body));
    PushDriver.PushContentsReceivedFor(phone).ShouldBeEmpty("her phone's push service receives nothing");
  }

  private async Task<TestDevice> LuciesRegisteredPhone() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    TestDevice phone = FakePushService.NewDevice("Lucie's phone");
    (await PushDriver.Register(phone)).ShouldBe(RegistrationAnswer.Registered);

    return phone;
  }

  private static JsonElement Parsed(string json) {
    using JsonDocument document = JsonDocument.Parse(json);

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}