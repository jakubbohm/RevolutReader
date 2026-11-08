using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The error code in a read's one log line (c006 design.md § Public API sketch, D7, D1 f): the code as received when the
/// error answer's <c>error</c> value has a code's shape; <c>none</c> when the answer carried no value (no body, a JSON
/// <c>null</c>, a body that is not JSON of the error answer's shape, a missing, <c>null</c> or blank <c>error</c>);
/// <c>unrecognised</c> when it carried a value of another shape, a text or not, which the line never quotes. Every value is
/// made up, each value of another shape holding a marker that must not turn up in the line.
/// </summary>
public sealed class ErrorCodeLogTests {
  /// <summary>Distinctive, so it cannot turn up in a log line by coincidence.</summary>
  private const string MARKER = "7f3a9c";

  private static readonly DateOnly _november1 = new(2026, 11, 1);

  /// <param name="status">The answer's HTTP status.</param>
  /// <param name="code">
  /// A code the read has a case for (the session expired, the bank's own error), and one it has none for, so the read
  /// ends as an error and still writes its line.
  /// </param>
  [Test]
  [Arguments(HttpStatusCode.UnprocessableEntity, "EXPIRED_SESSION")]
  [Arguments(HttpStatusCode.InternalServerError, "ASPSP_ERROR")]
  [Arguments(HttpStatusCode.NotFound, "ACCOUNT_DOES_NOT_EXIST")]
  public async Task The_log_line_carries_a_code_as_received(HttpStatusCode status, string code) {
    using BankOnWireMock bank = new();
    bank.Answers(status, $$"""{ "code": {{(int)status}}, "message": "made up", "error": "{{code}}", "detail": null }""");

    await ReadBalanceIgnoringItsError(bank);

    bank.LogLines.ShouldHaveSingleItem().Values["ErrorCode"].ShouldBe(code);
  }

  /// <param name="contentType">What the answer claims to be.</param>
  /// <param name="body">
  /// No body; a JSON <c>null</c>; a gateway's HTML page; JSON of another shape; an error answer whose <c>error</c> is
  /// missing, <c>null</c>, empty or blank. On a 503, so each read ends as bank unavailable.
  /// </param>
  [Test]
  [Arguments("application/json", "")]
  [Arguments("application/json", "null")]
  [Arguments("text/html", "<html><body>Service unavailable, maintenance</body></html>")]
  [Arguments("application/json", """["maintenance"]""")]
  [Arguments("application/json", """{ "code": 503, "message": "made up", "detail": null }""")]
  [Arguments("application/json", """{ "code": 503, "message": "made up", "error": null, "detail": null }""")]
  [Arguments("application/json", """{ "code": 503, "message": "made up", "error": "", "detail": null }""")]
  [Arguments("application/json", """{ "code": 503, "message": "made up", "error": "   ", "detail": null }""")]
  public async Task Without_an_error_value_the_log_line_says_none(string contentType, string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.ServiceUnavailable, body, contentType);

    (await bank.Account.ReadBalance(new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();

    bank.LogLines.ShouldHaveSingleItem().Values["ErrorCode"].ShouldBe("none");
  }

  /// <param name="status">The answer's HTTP status: a server error, which reads as bank unavailable, or a 4xx, which is an error.</param>
  /// <param name="error">
  /// An <c>error</c> value of another shape: a gateway's text; a text holding a path; a lower-case word; a number; an
  /// object.
  /// </param>
  [Test]
  [Arguments(HttpStatusCode.ServiceUnavailable, $"\"Service Unavailable {MARKER}\"")]
  [Arguments(HttpStatusCode.NotFound, $"\"Not found: /accounts/{MARKER}/balances\"")]
  [Arguments(HttpStatusCode.BadRequest, $"\"expired_session_{MARKER}\"")]
  [Arguments(HttpStatusCode.BadRequest, "7193")]
  [Arguments(HttpStatusCode.ServiceUnavailable, $$"""{ "reason": "{{MARKER}}" }""")]
  public async Task An_error_value_of_another_shape_is_logged_as_unrecognised_and_never_quoted(HttpStatusCode status, string error) {
    using BankOnWireMock bank = new();
    bank.Answers(status, $$"""{ "code": {{(int)status}}, "message": "made up", "error": {{error}}, "detail": null }""");

    await ReadBalanceIgnoringItsError(bank);

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Values["ErrorCode"].ShouldBe("unrecognised");
    line.Texts().ShouldAllBe(text => !text.Contains(MARKER, StringComparison.Ordinal) && !text.Contains("7193", StringComparison.Ordinal), "the line quotes no part of the value");
  }

  /// <summary>The transactions read's line says it the same way, for the page that failed.</summary>
  [Test]
  public async Task The_transactions_reads_log_line_logs_an_error_value_of_another_shape_as_unrecognised() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.ServiceUnavailable, $$"""{ "error": "Service Unavailable {{MARKER}}" }""");

    (await bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None)).Value.ShouldBeOfType<BankUnavailable>();

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Values["ErrorCode"].ShouldBe("unrecognised");
    line.Texts().ShouldAllBe(text => !text.Contains(MARKER, StringComparison.Ordinal), "the line quotes no part of the value");
  }

  /// <summary>A balance read whose answer may end it as an error: the line is written either way, which is what these tests check.</summary>
  private static async Task ReadBalanceIgnoringItsError(BankOnWireMock bank) {
    try {
      await bank.Account.ReadBalance(new Unattended(), CancellationToken.None);
    }
    catch (BankReadException) {
      // The error's own text is ErrorAnswerTests' subject.
    }
  }
}