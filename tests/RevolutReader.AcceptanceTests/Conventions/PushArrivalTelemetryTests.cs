using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// A push arrival's log lines (c016 design.md D4; c014 design.md D15: no line holds a time read; ADR-0004-account-allowlist,
/// Decision item 7: no line holds an email address): the delay only. Lucie, signed in, reports the arrival of a push whose
/// balance was read 75 seconds before the app's clock, and nothing the app copy logs during the whole test holds:
/// <list type="bullet">
/// <item>the read time, in any form a line could write it: the text as the report sent it (as System.Text.Json writes a
/// <see cref="DateTimeOffset"/>, D2), its round-trip form, its time of day to the second on a 24-hour and a 12-hour clock,
/// in UTC and in Prague time (which any date and time written to the second holds, in any culture's format), and the
/// instant as Unix seconds, Unix milliseconds or ticks;</item>
/// <item>an email address of the allowlist.</item>
/// </list>
/// The test first checks that the <c>PushArrived</c> line was written, read through the scenarios' own channel and found
/// in this guard's capture too, so it cannot pass without the line.
/// <para>
/// A rule, not a scenario, as <see cref="AccountCheckTelemetryTests"/>: a logger provider in the app copy's container
/// receives every entry the app's filters let through (<c>appsettings.json</c>'s levels), with its message, structured
/// values, scopes and exception (<see cref="CapturedLogTexts"/>), and sees only this app copy's loggers.
/// </para>
/// <para>
/// Every form of the read time looked for is distinctive: the times of day carry two colons and the seconds, which no
/// identifier or duration in a line spells out with these digits; the numbers have ten digits or more.
/// </para>
/// </summary>
public sealed class PushArrivalTelemetryTests : AcceptanceTest {
  /// <summary>The structured value the <c>PushArrived</c> line holds (design.md D4), as the capture writes it.</summary>
  private const string DELAY_SECONDS_VALUE = "DelaySeconds=";

  /// <summary>Prague's time zone, in which deployment.md's queries print times (D6).</summary>
  private const string PRAGUE = "Europe/Prague";

  /// <summary>How long before the app's clock the push's balance was read, as the scenario's.</summary>
  private static readonly TimeSpan _age = TimeSpan.FromSeconds(75);

  private readonly CapturedLogTexts _logs = new();

  [Test]
  public async Task A_reports_lines_hold_no_read_time_in_any_written_form_and_no_email_address() {
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);
    await SignIn.HasSignedIn(Visitor.Lucie);
    DateTimeOffset readAt = ArrivalDriver.Now - _age;

    (await ArrivalDriver.ReportReadAt(readAt)).ShouldBe(ReportAnswer.Accepted, "Lucie's report");

    Arrivals.RecordedDelays().ShouldHaveSingleItem("the PushArrived line");
    _logs.Texts().ShouldContain(static text => text.StartsWith(DELAY_SECONDS_VALUE, StringComparison.Ordinal), "the PushArrived line in this guard's capture");

    (string What, string Value)[] forbidden = [
      .. ReadTimeForms(readAt),
      ("Lucie's email", Visitor.Lucie.Email),
      ("Petr's email", Visitor.Petr.Email),
    ];
    IReadOnlyList<string> texts = _logs.Texts();

    forbidden.Where(value => texts.Any(text => text.Contains(value.Value, StringComparison.OrdinalIgnoreCase)))
      .Select(static value => value.What)
      .ShouldBeEmpty("Log messages, structured values, scope values or exceptions naming the read time or an email");
  }

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => _logs.Provider());

  /// <summary>
  /// <paramref name="readAt"/> in the forms a line could write it: as the report sent it, in the round-trip form, its time
  /// of day in UTC and in Prague time (<see cref="TimeOfDayForms"/>), and as Unix seconds, Unix milliseconds and ticks.
  /// </summary>
  private static (string What, string Value)[] ReadTimeForms(DateTimeOffset readAt) {
    DateTimeOffset inPrague = TimeZoneInfo.ConvertTime(readAt, TimeZoneInfo.FindSystemTimeZoneById(PRAGUE));

    return [
      ("the read time as the report sent it", JsonSerializer.Serialize(readAt).Trim('"')),
      ("the read time in the round-trip form", readAt.ToString("O", CultureInfo.InvariantCulture)),
      .. TimeOfDayForms("UTC", readAt.ToUniversalTime()),
      .. TimeOfDayForms("Prague time", inPrague),
      ("the read time as Unix seconds", readAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)),
      ("the read time as Unix milliseconds", readAt.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)),
      ("the read time in ticks", readAt.UtcTicks.ToString(CultureInfo.InvariantCulture)),
    ];
  }

  /// <summary>
  /// <paramref name="time"/>'s time of day to the second on a 24-hour and a 12-hour clock, which every date and time
  /// written to the second holds (with or without a leading zero, in any culture's order of the date).
  /// </summary>
  private static (string What, string Value)[] TimeOfDayForms(string zone, DateTimeOffset time) => [
    ($"the read time ({zone}, 24 h)", time.ToString("H:mm:ss", CultureInfo.InvariantCulture)),
    ($"the read time ({zone}, 12 h)", time.ToString("h:mm:ss", CultureInfo.InvariantCulture)),
  ];
}