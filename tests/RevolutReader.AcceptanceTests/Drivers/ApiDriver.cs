using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Calls the API over HTTP. <see cref="GetProblem"/> returns the problem description the API answered with (RFC 9457):
/// an error status, content type <c>application/problem+json</c>, a body whose <c>status</c> equals the response status,
/// and a title that is the case belonging to that status (case → status table, docs/conventions/README.md); otherwise
/// <see langword="null"/>. Stub until wiring (tasks.md 3.2).
/// </summary>
public sealed class ApiDriver {
  private readonly HttpClient _http;

  public ApiDriver(HttpClient http) => _http = http;

  public Task<ProblemDescription?> GetProblem(string path) => throw new NotImplementedException();
}