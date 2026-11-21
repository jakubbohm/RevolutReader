namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the API answered a phone's report of a push's arrival (spec push-arrivals, c016 design.md D3), compared by value:
/// accepted, or a refusal's problem description. The driver (<see cref="Drivers.ArrivalDriver"/>) gives a value only when
/// the answer's exact shape fits one (a success without content for <see cref="Accepted"/>; a problem as it describes),
/// so status codes never reach a scenario.
/// </summary>
/// <param name="Problem">The refusal's problem description; <see langword="null"/> when accepted.</param>
public sealed record ReportAnswer(ProblemDescription? Problem) {
  /// <summary>The report is accepted: the server has recorded the arrival.</summary>
  public static ReportAnswer Accepted { get; } = new(Problem: null);

  /// <summary>Refused with this problem description.</summary>
  public static ReportAnswer Refused(ProblemDescription problem) => new(problem);
}