using System.Net;
using System.Text.Json;
using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Calls the API over HTTP, without signing in. <see cref="GetProblem"/> and <see cref="PostProblem"/> return the problem
/// description the API answered with (RFC 9457): an error status, content type <c>application/problem+json</c>, a body
/// whose <c>status</c> equals the response status, and a title that is the case belonging to that status (case → status
/// table, docs/conventions/README.md); otherwise <see langword="null"/>.
/// </summary>
public sealed class ApiDriver {
  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The cases of the case → status table (docs/conventions/README.md) that the DSL knows, with their status.</summary>
  private static readonly Dictionary<ProblemDescription, HttpStatusCode> _statusByCase = new() {
    [ProblemDescription.NotFound] = HttpStatusCode.NotFound,
    [ProblemDescription.Unauthorized] = HttpStatusCode.Unauthorized,
  };

  private readonly HttpClient _http;

  public ApiDriver(HttpClient http) => _http = http;

  public async Task<ProblemDescription?> GetProblem(string path) {
    using HttpResponseMessage response = await _http.GetAsync(new Uri(path, UriKind.Relative));

    return await ProblemOf(response);
  }

  /// <summary>A <c>POST</c> without a body and without a browser's fetch metadata, as a script or a typo sends one.</summary>
  public async Task<ProblemDescription?> PostProblem(string path) {
    using HttpResponseMessage response = await _http.PostAsync(new Uri(path, UriKind.Relative), content: null);

    return await ProblemOf(response);
  }

  private static async Task<ProblemDescription?> ProblemOf(HttpResponseMessage response) {
    int status = (int)response.StatusCode;

    if (status is < 400 or > 599)
      return null;

    if (!string.Equals(response.Content.Headers.ContentType?.MediaType, PROBLEM_JSON, StringComparison.OrdinalIgnoreCase))
      return null;

    string? title = TitleIfStatusMatches(await response.Content.ReadAsStringAsync(), status);

    if (title is null)
      return null;

    ProblemDescription problem = new(title);

    return _statusByCase.TryGetValue(problem, out HttpStatusCode caseStatus) && caseStatus == response.StatusCode ? problem : null;
  }

  /// <summary>The body's <c>title</c>, when the body is a JSON object whose <c>status</c> equals <paramref name="status"/>; otherwise <see langword="null"/>.</summary>
  private static string? TitleIfStatusMatches(string body, int status) {
    try {
      using JsonDocument document = JsonDocument.Parse(body);
      JsonElement root = document.RootElement;

      bool statusMatches = root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("status", out JsonElement bodyStatus)
        && bodyStatus.ValueKind == JsonValueKind.Number
        && bodyStatus.TryGetInt32(out int value)
        && value == status;

      return statusMatches && root.TryGetProperty("title", out JsonElement title) && title.ValueKind == JsonValueKind.String ? title.GetString() : null;
    }
    catch (JsonException) {
      return null;
    }
  }
}