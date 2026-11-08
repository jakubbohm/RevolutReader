namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A problem description the API answered with (spec api-errors), identified by the case its title names. The driver
/// returns one only when the answer's status, content type and body agree (<see cref="Drivers.ApiDriver"/>).
/// </summary>
public sealed record ProblemDescription(string Title) {
  /// <summary>The API does not serve the address: title <c>Not Found</c>, status 404.</summary>
  public static ProblemDescription NotFound { get; } = new("Not Found");

  /// <summary>Nobody is signed in: title <c>Unauthorized</c>, status 401.</summary>
  public static ProblemDescription Unauthorized { get; } = new("Unauthorized");
}