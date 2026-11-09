using System.Text.Json;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// Every push carries a Declarative Web Push message (spec push-sending, c011 design.md D2): JSON with <c>web_push</c> 8030
/// and a <c>notification</c> holding the title, the text as <c>body</c> when there is text, and <c>navigate</c>, the app's
/// own address (<c>Push:Subject</c>) with the message's page, <c>/</c> by default. Never <c>app_badge</c>, and nothing else
/// is added. The tests read the JSON as a browser does, by member and value, never by its text's formatting. The app's
/// address is made up, an https origin of a reserved domain. The rules (<see cref="PushMessages.Check"/>, D10) refuse a
/// message a push cannot carry, naming the member with a fixed reason, never its value.
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

  /// <summary>
  /// A message whose title is empty is refused, naming <c>title</c> alone, with a fixed reason (D10). The endpoint maps a
  /// title left out of the request itself (the sketch's <c>MessageEndpoint</c>); to the rules, a message without a title is
  /// one whose title has nothing in it.
  /// </summary>
  [Test]
  public void A_message_without_a_title_is_refused_naming_the_title() =>
    ShouldRefuseOnlyTheTitle(new PushMessage(string.Empty, TEXT, PAGE));

  /// <summary>A title of spaces only is blank: refused as a missing one (D10), naming <c>title</c> alone, with a fixed reason.</summary>
  [Test]
  public void A_message_whose_title_is_only_spaces_is_refused_naming_the_title() =>
    ShouldRefuseOnlyTheTitle(new PushMessage("   ", TEXT, PAGE));

  /// <summary>
  /// A page of the app is a path that starts with a single <c>/</c> and lies outside <c>/api</c> (D2): the start page and
  /// any path under it, with or without a query. "Outside <c>/api</c>" is by whole segment, as the app's own pages are
  /// (<c>PagesExtensions</c>: every address whose first segment is not <c>api</c>), so a path that only begins with the
  /// letters "api", or has <c>api</c> further down, is a page.
  /// </summary>
  [Test]
  [Arguments("/")]
  [Arguments("/transakce")]
  [Arguments("/transakce/2026-11")]
  [Arguments("/?od=2026-11-01")]
  [Arguments("/transakce?od=2026-11-01&do=2026-11-09")]
  [Arguments("/apiary")] // begins with the letters "api", but its first segment is not api
  [Arguments("/apis/x")]
  [Arguments("/transakce/api")] // api further down
  public void The_start_page_and_a_path_under_it_with_or_without_a_query_are_pages_of_the_app(string page) =>
    PushMessages.IsAppPage(page).ShouldBeTrue();

  /// <summary>An absolute address is not a page, also one at the app's own address: a page is a path (D2), which the server puts on the app's address itself.</summary>
  [Test]
  [Arguments("https://example.com/")]
  [Arguments("https://app.example.net/transakce")] // the app's own address, but absolute
  [Arguments("http://example.com/")]
  [Arguments("mailto:someone@example.com")]
  [Arguments("javascript:alert(1)")]
  public void An_absolute_address_is_not_a_page_of_the_app(string page) =>
    PushMessages.IsAppPage(page).ShouldBeFalse();

  /// <summary>Two slashes, or a slash and a backslash (which browsers read as two slashes), start an address on another host, not a path (D2).</summary>
  [Test]
  [Arguments("//example.com/")]
  [Arguments("//example.com")]
  [Arguments("///example.com/")]
  [Arguments("/\\example.com/")]
  [Arguments("/\\example.com")]
  public void A_path_starting_with_two_slashes_or_a_slash_and_a_backslash_is_not_a_page_of_the_app(string page) =>
    PushMessages.IsAppPage(page).ShouldBeFalse();

  /// <summary>
  /// The addresses under <c>/api</c> are the API's, not pages (D2): <c>/api</c> itself, with a trailing slash, a query or
  /// more segments, in any letter case, as the app's own routes compare them (<c>PagesExtensions</c>).
  /// </summary>
  [Test]
  [Arguments("/api")]
  [Arguments("/api/")]
  [Arguments("/api/push/messages")]
  [Arguments("/api?x=1")]
  [Arguments("/api/?x=1")]
  [Arguments("/API/x")]
  [Arguments("/Api")]
  public void A_path_under_api_is_not_a_page_of_the_app(string page) =>
    PushMessages.IsAppPage(page).ShouldBeFalse();

  [Test]
  public void An_empty_page_is_not_a_page_of_the_app() =>
    PushMessages.IsAppPage(string.Empty).ShouldBeFalse();

  /// <summary>A message whose page is not a page of the app is refused, naming <c>page</c> alone, with a fixed reason that quotes nothing of the page (D10).</summary>
  /// <param name="page">A page from each kind the rules refuse.</param>
  [Test]
  [Arguments("https://example.com/stranka-3c5d")]
  [Arguments("//example.com/stranka-3c5d")]
  [Arguments("/api/stranka-3c5d")]
  [Arguments("")]
  public void A_message_whose_page_is_not_a_page_of_the_app_is_refused_naming_the_page(string page) {
    RefusedMember refused = PushMessages.Check(new PushMessage(TITLE, TEXT, page), _appAddress).ShouldHaveSingleItem("only the page is refused; the title and the text are fine");

    refused.ShouldSatisfyAllConditions(
      () => refused.Member.ShouldBe("page"),
      () => refused.Reason.ShouldNotBeNullOrWhiteSpace("a fixed reason"),
      () => refused.Reason.ShouldNotContain("example.com", Case.Insensitive, "never a value"),
      () => refused.Reason.ShouldNotContain("stranka-3c5d", Case.Insensitive, "never a value"));
  }

  /// <summary>The rules refuse exactly one member of <paramref name="message"/>, <c>title</c>, with a reason that holds none of the message's values.</summary>
  private static void ShouldRefuseOnlyTheTitle(PushMessage message) {
    RefusedMember refused = PushMessages.Check(message, _appAddress).ShouldHaveSingleItem("only the title is refused; the text and the page are fine");

    refused.ShouldSatisfyAllConditions(
      () => refused.Member.ShouldBe("title"),
      () => refused.Reason.ShouldNotBeNullOrWhiteSpace("a fixed reason"),
      () => refused.Reason.ShouldNotContain(TEXT, Case.Insensitive, "never a value"),
      () => refused.Reason.ShouldNotContain(PAGE, Case.Insensitive, "never a value"));
  }

  /// <summary>The message's JSON for the made-up app address, parsed as a browser reads it.</summary>
  private static JsonElement DeclarativeJson(PushMessage message) {
    using JsonDocument document = JsonDocument.Parse(PushMessages.DeclarativeJson(message, _appAddress));

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}