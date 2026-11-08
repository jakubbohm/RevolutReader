using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A request that matched no real route is not refused for want of a sign-in (c007 design.md D3, docs/conventions/README.md
/// § Backend code, secure by default). ASP.NET applies the fallback policy also to a request that matched no endpoint,
/// and to the router's own method rejection, so without the app's authorization result handler (<c>UnmatchedRequestsPass</c>)
/// an anonymous caller would get 401 for both. Every address under <c>/api</c> now has the catch-all <c>ApiNotFound</c>,
/// so only page addresses reach the handler that way:
/// <list type="bullet">
/// <item>a missing file (a page address with a file extension, which the page fallback leaves alone, and no such file):
/// no endpoint at all, so 404;</item>
/// <item>a write to a page address: the page fallback takes only GET and HEAD, so the router's 405.</item>
/// </list>
/// Both asked anonymously. A rule, not a scenario: the specs name no such address.
/// </summary>
public sealed class UnmatchedRequestsTests : AcceptanceTest {
  /// <summary>A page address with a file extension that no file in the web root has.</summary>
  private const string MISSING_FILE = "/no-such-file.js";

  /// <summary>A page address without a file extension: the page fallback's, for GET and HEAD only.</summary>
  private const string PAGE_ADDRESS = "/no-such-page";

  [Test]
  public async Task A_missing_file_answers_the_problem_Not_Found_to_an_anonymous_caller() =>
    (await ApiDriver.GetProblem(MISSING_FILE)).ShouldBe(ProblemDescription.NotFound);

  [Test]
  public async Task A_write_to_a_page_address_answers_the_routers_Method_Not_Allowed_to_an_anonymous_caller() =>
    (await ApiDriver.PostProblem(PAGE_ADDRESS)).ShouldBe(ProblemDescription.MethodNotAllowed);
}