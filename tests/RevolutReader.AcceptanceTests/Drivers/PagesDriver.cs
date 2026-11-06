using System.Net;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Opens page addresses over HTTP (spec app-delivery, c003 design.md D6). <see cref="PageAnswer.TheApp"/> only when all
/// three hold: status 200, content type <c>text/html</c> (the media type is compared; a parameter such as
/// <c>charset</c> is allowed), and a body equal to <see cref="StandInPages.StartPage"/>.
/// <see cref="PageAnswer.SomethingElse"/> for any other answer.
/// </summary>
public sealed class PagesDriver {
  private const string HTML = "text/html";

  private readonly HttpClient _http;

  public PagesDriver(HttpClient http) => _http = http;

  public async Task<PageAnswer> GetPage(string path) {
    using HttpResponseMessage response = await _http.GetAsync(new Uri(path, UriKind.Relative));

    if (response.StatusCode != HttpStatusCode.OK)
      return PageAnswer.SomethingElse;

    if (!string.Equals(response.Content.Headers.ContentType?.MediaType, HTML, StringComparison.OrdinalIgnoreCase))
      return PageAnswer.SomethingElse;

    string body = await response.Content.ReadAsStringAsync();

    return string.Equals(body, StandInPages.StartPage, StringComparison.Ordinal) ? PageAnswer.TheApp : PageAnswer.SomethingElse;
  }
}