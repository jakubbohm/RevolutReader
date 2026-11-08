using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A request the API cannot read answers with a problem description too (spec api-errors, "Error responses are problem
/// descriptions"; docs/conventions/README.md § Backend code: every non-2xx answer, including validation). FastEndpoints
/// binds a request's values itself and answers a value it cannot bind with 400 in its own error format unless told
/// otherwise; the sign-in's start is the first endpoint with a request, so a value that is not a boolean reaches that
/// path. The answer must be 400 with content type <c>application/problem+json</c>, a <c>status</c> of 400 and the title
/// <c>Bad Request</c>, which names the case as every other problem's title does (the status's reason phrase). Asked
/// anonymously. A rule, not a scenario: the specs name no such request.
/// </summary>
public sealed class UnreadableRequestsTests : AcceptanceTest {
  /// <summary>The sign-in's start with a value that is not a boolean.</summary>
  private const string UNREADABLE = "/api/auth/login?anotherAccount=banana";

  [Test]
  public async Task A_request_the_API_cannot_read_answers_the_problem_Bad_Request() {
    string answer = await ApiDriver.DescribeGet(UNREADABLE);

    (await ApiDriver.GetProblem(UNREADABLE)).ShouldBe(ProblemDescription.BadRequest, $"the API answered: {answer}");
  }
}