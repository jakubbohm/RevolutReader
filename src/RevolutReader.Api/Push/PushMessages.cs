using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace RevolutReader.Api.Push;

/// <summary>The message rules (c011 design.md D2, D10), pure.</summary>
public static class PushMessages {
  /// <summary>The member that marks a push as Declarative Web Push, and its one value (WebKit, iOS 18.4 and later).</summary>
  private const int DECLARATIVE_WEB_PUSH = 8030;

  /// <summary>The members a refusal names, as the message request names them (D10), and their fixed reasons.</summary>
  private const string TITLE = "title";
  private const string MISSING = "Missing.";

  /// <summary>
  /// Letters of every script as they are, so a Czech text takes its UTF-8 bytes rather than a six-character escape per
  /// letter, which counts against a push's size (D2); quotation marks, backslashes, control characters and the
  /// HTML-sensitive characters stay escaped, as the default encoder escapes them.
  /// </summary>
  private static readonly JsonSerializerOptions _json = new() { Encoder = JavaScriptEncoder.Create(UnicodeRanges.All) };

  /// <summary>Whether <paramref name="page"/> is a page of the app (D2): a path that starts with a single <c>/</c> and lies outside <c>/api</c>.</summary>
  public static bool IsAppPage(string page) => throw new NotImplementedException();

  /// <summary>The members of <paramref name="message"/> a push cannot carry, each with a fixed reason, never its value (D2, D10); none when it can.</summary>
  public static IReadOnlyList<RefusedMember> Check(PushMessage message, Uri appAddress) {
    ArgumentNullException.ThrowIfNull(message);
    ArgumentNullException.ThrowIfNull(appAddress);

    List<RefusedMember> refused = [];

    if (string.IsNullOrWhiteSpace(message.Title))
      refused.Add(new RefusedMember(TITLE, MISSING));

    return refused;
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