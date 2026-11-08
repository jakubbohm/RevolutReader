using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// An older page is asked for with <c>before</c>, a calendar date (c010 design.md D10). A request without one, with an
/// empty one, or with one that is not a date answers 400 with a problem description (spec api-errors, as
/// <see cref="UnreadableRequestsTests"/> checks for the sign-in's start) and reads nothing: no page, and no request to the
/// bank. The problem must be 400, <c>application/problem+json</c>, a body <c>status</c> of 400 and the title
/// <c>Bad Request</c>; its <c>type</c> is not compared, since FastEndpoints writes its own 400's differently from
/// ASP.NET's. Asked by Lucie, signed in and allowed: anyone else is refused before the request is read. A guard written
/// after the endpoint (tasks.md 29.2): a rule, not a scenario, since the specs name no such request.
/// </summary>
public sealed class OlderTransactionsRequestTests : AcceptanceTest {
  /// <param name="request">
  /// No query at all; <c>before</c> given empty; a word; a day that does not exist; and a date written the Czech way,
  /// which is a date to a person but not <c>yyyy-MM-dd</c>.
  /// </param>
  [Test]
  [Arguments("no before")]
  [Arguments("an empty before")]
  [Arguments("a before that is a word")]
  [Arguments("a before that is a day that does not exist")]
  [Arguments("a before written the Czech way")]
  public async Task An_older_page_asked_without_a_readable_before_answers_the_problem_Bad_Request_and_reads_nothing(string request) {
    string query = request switch {
      "no before" => string.Empty,
      "an empty before" => "before=",
      "a before that is a word" => "before=banana",
      "a before that is a day that does not exist" => "before=2026-02-30",
      "a before written the Czech way" => "before=20.11.2026",
      _ => throw new ArgumentOutOfRangeException(nameof(request), request, "Not a known case."),
    };
    await SignIn.HasSignedIn(Visitor.Lucie);

    (ProblemDescription? problem, string answer) = await TransactionsDriver.AskForOlderAsSent(query);

    problem.ShouldBe(ProblemDescription.BadRequest, $"the API answered: {answer}");
    Bank.RequestsReceived().ShouldBeEmpty("requests the bank received");
  }
}