using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// How the client handles Enable Banking's error answers (<c>{ message, code, error, detail }</c>; c004 design.md D4, D5):
/// the <c>error</c> code decides through <see cref="BankErrorClassification"/>, the status only when there is no code; an
/// answer no case fits, or an error body that cannot be read, is a <see cref="BankReadException"/> that names the status
/// and the code and quotes nothing else: no URL, no <c>message</c> or <c>detail</c>, no body. Every value is made up, or
/// copied from the Mock ASPSP's error capture, which holds no account data.
/// </summary>
public sealed class ErrorAnswerTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "7f3a9c";

  private static readonly DateOnly _november1 = new(2026, 11, 1);

  /// <summary>Written from the API reference: the Mock ASPSP cannot expire a session on demand (the acceptance driver's answer).</summary>
  private const string EXPIRED_SESSION = """{ "code": 422, "message": "Session has expired", "error": "EXPIRED_SESSION", "detail": null }""";

  [Test]
  public async Task An_error_answer_on_a_transactions_page_is_the_reads_failure() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.UnprocessableEntity, EXPIRED_SESSION);

    BankResult<Transactions> result = await bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankAccessExpired>();
  }

  /// <summary>
  /// The Mock ASPSP's answer for an unknown account (<c>spikes/enable-banking-mock/evidence/2026-11-04-error-responses.json</c>),
  /// with a made-up <c>detail</c>: a misconfiguration, so no case fits (D4 "everything else").
  /// </summary>
  [Test]
  public async Task An_error_code_no_case_fits_is_an_error_naming_only_the_status_and_the_code() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.NotFound, $$"""
      { "code": 404, "message": "No account found matching provided id", "error": "ACCOUNT_DOES_NOT_EXIST", "detail": "made-up detail {{MARKER}}" }
      """);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.Message.ShouldBe(new BankReadException(HttpStatusCode.NotFound, "ACCOUNT_DOES_NOT_EXIST").Message);
    ShouldQuoteNothing(error, bank, "No account found matching provided id", MARKER);
  }

  /// <param name="body">An error body without a usable code: the code missing, null, empty or blank; a JSON null; no body at all.</param>
  [Test]
  [Arguments("""{ "code": 400, "message": "made up", "detail": null }""")]
  [Arguments("""{ "code": 400, "message": "made up", "error": null, "detail": null }""")]
  [Arguments("""{ "code": 400, "message": "made up", "error": "", "detail": null }""")]
  [Arguments("""{ "code": 400, "message": "made up", "error": "   ", "detail": null }""")]
  [Arguments("null")]
  [Arguments("")]
  public async Task An_error_answer_without_an_error_code_is_decided_by_its_status(string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.BadRequest, body);

    // 400 without a code is a status no case fits (D4), so the answer ends as the error for that status and no code.
    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.Message.ShouldBe(new BankReadException(HttpStatusCode.BadRequest, errorCode: null).Message);
  }

  /// <param name="contentType">What the answer claims to be; the body is read the same way whatever it claims.</param>
  /// <param name="body">Not an Enable Banking error answer: a proxy's HTML page, plain text, JSON of another shape.</param>
  [Test]
  [Arguments("text/html", $"<html><body>Service unavailable, maintenance {MARKER}</body></html>")]
  [Arguments("text/plain", $"upstream connect error {MARKER}")]
  [Arguments("application/json", $"""["{MARKER}"]""")]
  [Arguments("application/json", $$"""{ "error": { "reason": "{{MARKER}}" } }""")]
  public async Task An_error_body_that_cannot_be_read_is_an_error_that_does_not_quote_it(string contentType, string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.ServiceUnavailable, body, contentType);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.Message.ShouldContain("503");
    ShouldQuoteNothing(error, bank, body, MARKER);
  }

  /// <summary>The error as it would be logged (message, inner exceptions, stack trace) holds neither the request's address nor any of these texts.</summary>
  private static void ShouldQuoteNothing(BankReadException error, BankOnWireMock bank, params string[] texts) {
    string text = error.ToString();

    text.ShouldNotContain(bank.AccountId, Case.Insensitive);
    text.ShouldNotContain("/accounts/", Case.Insensitive);

    foreach (string quoted in texts)
      text.ShouldNotContain(quoted, Case.Insensitive);
  }
}