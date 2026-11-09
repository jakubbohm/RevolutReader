using System.Text;
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

  /// <summary>The most bytes of JSON a push may carry (D2: RFC 8291 § 4, 4096 octets less the header, a padding octet and the tag).</summary>
  private const int MOST_BYTES = 3993;

  /// <summary>The size tests' title and page; the title has Czech letters, so the frame around the text is not ASCII only.</summary>
  private const string SIZED_TITLE = "Zůstatek se změnil";
  private const string SIZED_PAGE = "/transakce";

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

  /// <summary>
  /// A message whose page is not a page of the app is refused, naming <c>page</c> alone, with a fixed reason that quotes
  /// nothing of the page (D10). Also a page that is not even an address, which the app's address cannot be combined with
  /// (<c>new Uri(appAddress, page)</c> throws for it): refused like any other, never an exception.
  /// </summary>
  /// <param name="page">A page from each kind the rules refuse.</param>
  [Test]
  [Arguments("https://example.com/stranka-3c5d")]
  [Arguments("//example.com/stranka-3c5d")]
  [Arguments("/api/stranka-3c5d")]
  [Arguments("")]
  [Arguments("http://")] // not an address
  [Arguments("http://[")]
  [Arguments("a:b")]
  [Arguments("https://exa mple.com")]
  public void A_message_whose_page_is_not_a_page_of_the_app_is_refused_naming_the_page(string page) {
    RefusedMember refused = PushMessages.Check(new PushMessage(TITLE, TEXT, page), _appAddress).ShouldHaveSingleItem("only the page is refused; the title and the text are fine");

    refused.ShouldSatisfyAllConditions(
      () => refused.Member.ShouldBe("page"),
      () => refused.Reason.ShouldNotBeNullOrWhiteSpace("a fixed reason"),
      () => refused.Reason.ShouldNotContain("example.com", Case.Insensitive, "never a value"),
      () => refused.Reason.ShouldNotContain("stranka-3c5d", Case.Insensitive, "never a value"));
  }

  /// <summary>
  /// The most a push may carry is 3993 bytes of JSON (D2: RFC 8291 § 4), counted on the JSON the sender really sends, the
  /// app's address and the page included: a message of exactly that size is accepted.
  /// </summary>
  [Test]
  public void A_message_whose_JSON_is_exactly_3993_bytes_is_accepted() {
    PushMessage message = AsciiMessageOfBytes(MOST_BYTES);

    PushMessages.Check(message, _appAddress).ShouldBeEmpty("a push of exactly 3993 bytes fits");
  }

  /// <summary>One byte more is refused, naming <c>message</c> alone (D10), with a fixed reason that quotes nothing of it.</summary>
  [Test]
  public void A_message_whose_JSON_is_3994_bytes_is_refused_naming_the_message() {
    PushMessage message = AsciiMessageOfBytes(MOST_BYTES + 1);

    ShouldRefuseOnlyTheMessage(message);
  }

  /// <summary>
  /// The size counts UTF-8 bytes, and the JSON carries Czech letters as they are, two bytes each, never as a six-byte
  /// <c>\uXXXX</c> escape: a text of "ř"s built by that count to 3993 bytes is accepted, and one byte more is refused. A
  /// check that counts characters passes the longer one (it has about half as many characters as bytes); a JSON that
  /// escapes the letters refuses the shorter one.
  /// </summary>
  [Test]
  public void The_size_counts_UTF_8_bytes_so_Czech_letters_count_twice() {
    PushMessage atTheLimit = CzechMessageOfBytes(MOST_BYTES);
    PushMessage oneByteMore = CzechMessageOfBytes(MOST_BYTES + 1);

    atTheLimit.ShouldSatisfyAllConditions(
      () => PushMessages.Check(atTheLimit, _appAddress).ShouldBeEmpty("Czech text of exactly 3993 bytes fits"),
      () => PushMessages.Check(oneByteMore, _appAddress).ShouldHaveSingleItem("Czech text of 3994 bytes is too long").Member.ShouldBe("message"));
  }

  /// <summary>
  /// A message to <see cref="SIZED_PAGE"/> whose JSON is exactly <paramref name="bytes"/> bytes, padded with ASCII letters
  /// in its text, measured on <see cref="PushMessages.DeclarativeJson"/> (ASCII letters take one byte each, however
  /// written).
  /// </summary>
  private static PushMessage AsciiMessageOfBytes(int bytes) {
    int frame = JsonBytes(new PushMessage(SIZED_TITLE, string.Empty, SIZED_PAGE));
    PushMessage message = new(SIZED_TITLE, new string('x', bytes - frame), SIZED_PAGE);

    JsonBytes(message).ShouldBe(bytes, "the test's own message is the size it means to be");

    return message;
  }

  /// <summary>
  /// A message whose JSON is <paramref name="bytes"/> bytes when every "ř" takes two UTF-8 bytes: a text of "ř"s, with an
  /// "x" when the count is odd. The size is worked out by that rule, not measured, so a JSON that escapes the letters does
  /// not move the boundary with it.
  /// </summary>
  private static PushMessage CzechMessageOfBytes(int bytes) {
    int text = bytes - JsonBytes(new PushMessage(SIZED_TITLE, string.Empty, SIZED_PAGE));

    return new PushMessage(SIZED_TITLE, new string('ř', text / 2) + (text % 2 == 1 ? "x" : string.Empty), SIZED_PAGE);
  }

  /// <summary>The UTF-8 bytes of the message's JSON on the made-up app address.</summary>
  private static int JsonBytes(PushMessage message) => Encoding.UTF8.GetByteCount(PushMessages.DeclarativeJson(message, _appAddress));

  /// <summary>The rules refuse exactly one member of <paramref name="message"/>, <c>message</c>, with a reason that quotes nothing of it.</summary>
  private static void ShouldRefuseOnlyTheMessage(PushMessage message) {
    RefusedMember refused = PushMessages.Check(message, _appAddress).ShouldHaveSingleItem("only the size is refused; the title and the page are fine");

    refused.ShouldSatisfyAllConditions(
      () => refused.Member.ShouldBe("message"),
      () => refused.Reason.ShouldNotBeNullOrWhiteSpace("a fixed reason"),
      () => refused.Reason.ShouldNotContain(SIZED_TITLE, Case.Insensitive, "never a value"),
      () => refused.Reason.ShouldNotContain("xxxx", Case.Insensitive, "never a value"));
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