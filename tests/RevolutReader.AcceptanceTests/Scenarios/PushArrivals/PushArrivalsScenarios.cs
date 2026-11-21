using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.PushArrivals;

public sealed class PushArrivalsScenarios : AcceptanceTest {
  [Test, Scenario("push-arrivals", "A report records how long the push took to arrive")]
  public async Task A_report_records_how_long_the_push_took_to_arrive() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Arrivals.PhoneReportsAPushReadEarlier(TimeSpan.FromSeconds(75))).ShouldBe(ReportAnswer.Accepted);
    Arrivals.RecordedDelays().ShouldBe([75L], "one arrival, 75 seconds after the read");
  }

  [Test, Scenario("push-arrivals", "A report whose read time lies ahead records 0 seconds")]
  public async Task A_report_whose_read_time_lies_ahead_records_0_seconds() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    await Arrivals.PhoneReportsAPushReadAhead(TimeSpan.FromSeconds(30));

    Arrivals.RecordedDelays().ShouldBe([0L], "one arrival, 0 seconds after the read");
  }

  [Test, Scenario("push-arrivals", "A report without a read time is refused and records nothing")]
  public async Task A_report_without_a_read_time_is_refused_and_records_nothing() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Arrivals.PhoneReportsAnArrivalWithNoReadTime()).ShouldBe(ReportAnswer.Refused(ProblemDescription.BadRequest));
    Arrivals.RecordedDelays().ShouldBeEmpty("no arrival recorded");
  }
}