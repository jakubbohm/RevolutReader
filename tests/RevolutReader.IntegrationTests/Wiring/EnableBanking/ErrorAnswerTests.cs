using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// How the client handles Enable Banking's error answers (<c>{ message, code, error, detail }</c>; c004 design.md D4, D5):
/// the <c>error</c> code decides through <see cref="BankErrorClassification"/>, the status only when there is no code. Only
/// a value of a code's shape is a code (c006 design.md D3, D7): a body that cannot be read, a value that is not a text and
/// a text of another shape all count as no code, so the status decides (5xx and 408 bank unavailable, 429 rate limited).
/// An answer no case fits is a <see cref="BankReadException"/> that names the status and the code, "no error code" or "an
/// unrecognised error value", and quotes nothing else: no URL, no <c>message</c> or <c>detail</c>, no body, no value of
/// another shape. Every value is made up, or copied from the Mock ASPSP's error capture, which holds no account data.
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
  /// <param name="body">
  /// Not an Enable Banking error answer: a proxy's HTML page, plain text, JSON of another shape, an <c>error</c> that is
  /// not a text. A server error without a code is the bank's own error (D3).
  /// </param>
  [Test]
  [Arguments("text/html", $"<html><body>Service unavailable, maintenance {MARKER}</body></html>")]
  [Arguments("text/plain", $"upstream connect error {MARKER}")]
  [Arguments("application/json", $"""["{MARKER}"]""")]
  [Arguments("application/json", $$"""{ "error": { "reason": "{{MARKER}}" } }""")]
  public async Task An_error_body_that_cannot_be_read_on_a_server_error_is_bank_unavailable(string contentType, string body) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.ServiceUnavailable, body, contentType);

    BankResult<Balance> result = await bank.Account.ReadBalance(new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>A 4xx with a proxy's HTML page stays an error, now named by its status and no code (D3), and quotes nothing from the page.</summary>
  [Test]
  public async Task An_error_body_that_cannot_be_read_on_a_400_is_an_error_naming_only_the_status_that_does_not_quote_it() {
    const string body = $"<html><body>Bad request, rejected by the proxy {MARKER}</body></html>";

    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.BadRequest, body, "text/html");

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.Message.ShouldBe(new BankReadException(HttpStatusCode.BadRequest, errorCode: null).Message);
    ShouldQuoteNothing(error, bank, body, MARKER);
  }

  /// <summary>A gateway's own rate limit, answered with its HTML page and no code: the status decides (D3).</summary>
  [Test]
  public async Task A_429_with_a_gateways_HTML_page_is_rate_limited() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.TooManyRequests, $"<html><body>Too many requests {MARKER}</body></html>", "text/html");

    BankResult<Balance> result = await bank.Account.ReadBalance(new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankRateLimited>();
  }

  /// <summary>A gateway's JSON error: an <c>error</c> text that is not shaped like a code is no code (D3, D7).</summary>
  [Test]
  public async Task A_503_whose_error_text_is_not_a_code_is_bank_unavailable() {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.ServiceUnavailable, """{"error":"Service Unavailable"}""");

    BankResult<Balance> result = await bank.Account.ReadBalance(new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<BankUnavailable>();
  }

  /// <summary>
  /// The audit's probe (D1 f): a 404 whose <c>error</c> is a text holding the request's path, the account id in it. No case
  /// fits a 404 without a code, so it is an error; the text is not a code, so the error says only that the value was
  /// unrecognised.
  /// </summary>
  [Test]
  public async Task A_404_whose_error_text_holds_a_path_is_an_error_quoting_neither_the_text_nor_the_account_id() {
    using BankOnWireMock bank = new();
    string text = $"Not found: /accounts/{bank.AccountId}/balances";
    bank.Answers(HttpStatusCode.NotFound, $$"""{ "code": 404, "error": "{{text}}" }""");

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    error.Message.ShouldBe(BankReadException.ForUnrecognisedErrorValue(HttpStatusCode.NotFound).Message);
    error.Message.ShouldContain("an unrecognised error value");
    ShouldQuoteNothing(error, bank, text);
  }

  /// <param name="error">An <c>error</c> value that is not a text: a number, an object, a list, a truth value.</param>
  [Test]
  [Arguments("42")]
  [Arguments($$"""{ "reason": "{{MARKER}}" }""")]
  [Arguments($"""["{MARKER}"]""")]
  [Arguments("true")]
  public async Task An_error_value_that_is_not_a_text_on_a_400_is_an_error_saying_the_value_was_unrecognised(string error) {
    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.BadRequest, $$"""{ "code": 400, "error": {{error}} }""");

    BankReadException thrown = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadBalance(new Unattended(), CancellationToken.None));

    thrown.Message.ShouldBe(BankReadException.ForUnrecognisedErrorValue(HttpStatusCode.BadRequest).Message);
    ShouldQuoteNothing(thrown, bank, MARKER);
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