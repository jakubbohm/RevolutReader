using System.Text.Json;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Every push carries a Declarative Web Push message (spec push-sending, c011 design.md D2): JSON with <c>web_push</c> 8030
/// and a <c>notification</c> holding the title, the text as <c>body</c> when there is text, and <c>navigate</c>, the app's
/// own address (<c>Push:Subject</c>) with the message's page, <c>/</c> by default. Never <c>app_badge</c>, and nothing else
/// is added. The tests read the JSON as a browser does, by member and value, never by its text's formatting. The app's
/// address is made up, an https origin of a reserved domain.
/// </summary>
public sealed class PushMessagesTests {
  private const string TITLE = "Ahoj";

  /// <summary>A text with a quotation mark and a line break, which JSON must escape.</summary>
  private const string TEXT = "Zkušební zpráva s \"uvozovkami\"\na druhým řádkem";

  private const string PAGE = "/transakce";

  private static readonly Uri _appAddress = new("https://app.example.net");

  [Test]
  public void A_message_becomes_Declarative_Web_Push_JSON_with_web_push_8030_its_title_its_text_as_body_and_navigate_at_the_apps_address_of_its_page() {
    JsonElement json = DeclarativeJson(new PushMessage(TITLE, TEXT, PAGE));

    JsonElement webPush = json.GetProperty("web_push");
    webPush.ValueKind.ShouldBe(JsonValueKind.Number, "web_push is the number 8030, not a text");
    webPush.GetInt32().ShouldBe(8030);

    JsonElement notification = json.GetProperty("notification");
    notification.GetProperty("title").GetString().ShouldBe(TITLE);
    notification.GetProperty("body").GetString().ShouldBe(TEXT);
    notification.GetProperty("navigate").GetString().ShouldBe("https://app.example.net/transakce");
  }

  [Test]
  public void A_message_without_text_leaves_body_out() =>
    MemberNames(DeclarativeJson(new PushMessage(TITLE, Text: null, PAGE)).GetProperty("notification"))
      .ShouldNotContain("body", "a message without text has no body member, not even an empty or null one");

  [Test]
  public void A_message_without_a_page_navigates_to_the_apps_start_page() =>
    DeclarativeJson(new PushMessage(TITLE, TEXT)).GetProperty("notification").GetProperty("navigate").GetString()
      .ShouldBe("https://app.example.net/");

  /// <summary>Exactly the members the format needs: <c>app_badge</c>, or any other member, would be one too many.</summary>
  [Test]
  public void The_JSON_carries_no_badge_and_nothing_else() {
    JsonElement json = DeclarativeJson(new PushMessage(TITLE, TEXT, PAGE));

    MemberNames(json).ShouldBe(["web_push", "notification"], ignoreOrder: true);
    MemberNames(json.GetProperty("notification")).ShouldBe(["title", "body", "navigate"], ignoreOrder: true);
  }

  /// <summary>The message's JSON for the made-up app address, parsed as a browser reads it.</summary>
  private static JsonElement DeclarativeJson(PushMessage message) {
    using JsonDocument document = JsonDocument.Parse(PushMessages.DeclarativeJson(message, _appAddress));

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}