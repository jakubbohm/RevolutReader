using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Text.Unicode;

namespace RevolutReader.Api.Push;

/// <summary>The message rules (c011 design.md D2, D10), pure.</summary>
public static partial class PushMessages {
  /// <summary>The member that marks a push as Declarative Web Push, and its one value (WebKit, iOS 18.4 and later).</summary>
  private const int DECLARATIVE_WEB_PUSH = 8030;

  /// <summary>The members a refusal names, as the message request names them (D10), and their fixed reasons.</summary>
  private const string TITLE = "title";
  private const string MISSING = "Missing.";
  private const string PAGE = "page";
  private const string NOT_A_PAGE = "Not a page of the app.";
  private const string MESSAGE = "message";
  private const string TOO_LONG = "Too long for a push.";

  /// <summary>The API's first segment: <c>/api</c> and every path under it are the API's, not pages (D2).</summary>
  private const string API = "/api";

  /// <summary>
  /// The most UTF-8 bytes a push's JSON may take (D2): the plaintext a push service must accept, RFC 8291 § 4, 4096 octets
  /// of body less the 86-octet header, one octet of padding and the 16-octet tag.
  /// </summary>
  public const int MOST_BYTES = 3993;

  /// <summary>
  /// Letters of every script as they are, so a Czech text takes its UTF-8 bytes rather than a six-character escape per
  /// letter, which counts against a push's size (D2); quotation marks, backslashes, control characters and the
  /// HTML-sensitive characters stay escaped, as the default encoder escapes them.
  /// </summary>
  private static readonly JsonSerializerOptions _json = new() { Encoder = JavaScriptEncoder.Create(UnicodeRanges.All) };

  /// <summary>
  /// The address a page is put on to see the address it opens. A page is a path, and a path keeps the same path on any
  /// address, so what it opens here it opens on the app's own; the domain is reserved, so it is never reached.
  /// </summary>
  private static readonly Uri _anyAppAddress = new("https://app.invalid/");

  /// <summary>
  /// Whether <paramref name="page"/> is a page of the app (D2): a path that starts with a single <c>/</c> and, put on the
  /// app's address as <c>navigate</c> is, opens an address of the app itself, outside <c>/api</c>.
  /// </summary>
  /// <remarks>
  /// A single <c>/</c>: two slashes, or a slash and a backslash (which browsers read alike), start an address on another
  /// host. The address it opens is the one <see cref="Uri"/> resolves, as <see cref="DeclarativeJson"/> builds
  /// <c>navigate</c>, so a page is judged by what it opens, never by its text: a backslash read as a slash, <c>.</c> and
  /// <c>..</c> segments removed, letters written percent-encoded read as letters. That address must keep the app's
  /// scheme, host and port, and its path must lie outside <c>/api</c> by whole first segment, ignoring case, as the app's
  /// own page route compares it (<c>PagesExtensions</c>); a query or a fragment is no part of the path. A page that
  /// cannot be put on an address opens nothing, so it is no page either.
  /// </remarks>
  public static bool IsAppPage(string page) {
    ArgumentNullException.ThrowIfNull(page);

    return SingleSlashPath().IsMatch(page) && OpensAPageOfTheApp(page);
  }

  /// <summary>The members of <paramref name="message"/> a push cannot carry, each with a fixed reason, never its value (D2, D10); none when it can.</summary>
  public static IReadOnlyList<RefusedMember> Check(PushMessage message, Uri appAddress) {
    ArgumentNullException.ThrowIfNull(message);
    ArgumentNullException.ThrowIfNull(appAddress);

    List<RefusedMember> refused = [];

    if (string.IsNullOrWhiteSpace(message.Title))
      refused.Add(new RefusedMember(TITLE, MISSING));

    if (!IsAppPage(message.Page))
      refused.Add(new RefusedMember(PAGE, NOT_A_PAGE));
    else if (Encoding.UTF8.GetByteCount(DeclarativeJson(message, appAddress)) > MOST_BYTES)
      refused.Add(new RefusedMember(MESSAGE, TOO_LONG));

    return refused;
  }

  /// <summary>A text that starts with a single <c>/</c>, as <see cref="IsAppPage"/> describes.</summary>
  [GeneratedRegex(@"^/(?![/\\])", RegexOptions.CultureInvariant)]
  private static partial Regex SingleSlashPath();

  /// <summary>
  /// Whether <paramref name="page"/>, put on an app's address, opens an address of that app outside <c>/api</c>, as
  /// <see cref="IsAppPage"/> describes; <see langword="false"/> when it cannot be put on an address.
  /// </summary>
  private static bool OpensAPageOfTheApp(string page) {
    if (!Uri.TryCreate(_anyAppAddress, page, out Uri? opened)
        || !string.Equals(opened.GetLeftPart(UriPartial.Authority), _anyAppAddress.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
      return false;

    string path = opened.AbsolutePath;

    return !path.Equals(API, StringComparison.OrdinalIgnoreCase) && !path.StartsWith($"{API}/", StringComparison.OrdinalIgnoreCase);
  }

  /// <summary>
  /// The Declarative Web Push JSON (D2): <c>web_push</c> 8030 and a <c>notification</c> with the title, the text as
  /// <c>body</c> only when there is text, and <c>navigate</c>, the page resolved against <paramref name="appAddress"/>
  /// (<c>Push:Subject</c>). Never <c>app_badge</c>, and nothing else.
  /// </summary>
  public static string DeclarativeJson(PushMessage message, Uri appAddress) {
    ArgumentNullException.ThrowIfNull(message);
    ArgumentNullException.ThrowIfNull(appAddress);

    DeclarativePush push = new(DECLARATIVE_WEB_PUSH, new Notification(message.Title, message.Text, new Uri(appAddress, message.Page).AbsoluteUri));

    return JsonSerializer.Serialize(push, _json);
  }

  /// <summary>The push's JSON as Declarative Web Push names its members.</summary>
  private sealed record DeclarativePush(
    [property: JsonPropertyName("web_push")] int WebPush,
    [property: JsonPropertyName("notification")] Notification Notification);

  /// <summary>The notification Safari shows by itself; <c>body</c> left out when there is no text.</summary>
  private sealed record Notification(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("body"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Body,
    [property: JsonPropertyName("navigate")] string Navigate);
}