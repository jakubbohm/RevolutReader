using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>The API as a caller who has not signed in sees it (spec api-errors).</summary>
public sealed class ApiDsl(ApiDriver driver) {
  /// <summary>The address from the scenarios: under <c>/api</c>, served by no endpoint.</summary>
  private const string ADDRESS_THAT_DOES_NOT_EXIST = "/api/no-such-address";

  /// <returns>The problem description the API answered with, or <see langword="null"/> when the answer is not one.</returns>
  public Task<ProblemDescription?> AskForAnAddressThatDoesNotExist() => driver.GetProblem(ADDRESS_THAT_DOES_NOT_EXIST);

  /// <returns>The problem description the API answered a write with, or <see langword="null"/> when the answer is not one.</returns>
  public Task<ProblemDescription?> SendAWriteToAnAddressThatDoesNotExist() => driver.PostProblem(ADDRESS_THAT_DOES_NOT_EXIST);
}