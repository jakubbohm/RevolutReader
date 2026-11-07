using System.Net;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// What an error answer from Enable Banking means (c004 design.md D4's table): Enable Banking's <c>error</c> code decides,
/// and the HTTP status only when the body carries no code. The API reference does not say which status comes with which
/// code, so each code is tried with a status the bank plausibly sends with it (<c>422</c>) and with statuses that, without
/// a code, would decide something else: <c>429</c> (rate limited) and <c>503</c> (bank unavailable).
/// </summary>
public sealed class BankErrorClassificationTests {
  // Access expired: only the owner can fix it, by linking the account again

  [Test, MatrixDataSource]
  public void Expired_revoked_closed_and_unknown_sessions_are_access_expired(
    [Matrix("EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST")] string errorCode,
    [Matrix(HttpStatusCode.UnprocessableEntity, HttpStatusCode.TooManyRequests, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.AccessExpired);

  [Test, MatrixDataSource]
  public void The_bank_needing_the_account_holder_is_access_expired(
    [Matrix(HttpStatusCode.UnprocessableEntity, HttpStatusCode.TooManyRequests, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, "ASPSP_PSU_ACTION_REQUIRED").ShouldBe(BankErrorKind.AccessExpired);

  [Test, MatrixDataSource]
  public void No_accounts_added_or_the_account_no_longer_accessible_is_access_expired(
    [Matrix("NO_ACCOUNTS_ADDED", "ASPSP_ACCOUNT_NOT_ACCESSIBLE")] string errorCode,
    [Matrix(HttpStatusCode.UnprocessableEntity, HttpStatusCode.TooManyRequests, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.AccessExpired);

  // Rate limited: never retried (ADR-0001)

  /// <param name="status"><c>429</c>, as the bank sends it with this code; <c>422</c> and <c>503</c>, which without the code would decide otherwise.</param>
  [Test, MatrixDataSource]
  public void The_banks_rate_limit_is_rate_limited(
    [Matrix(HttpStatusCode.TooManyRequests, HttpStatusCode.UnprocessableEntity, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, "ASPSP_RATE_LIMIT_EXCEEDED").ShouldBe(BankErrorKind.RateLimited);

  /// <param name="errorCode">No code: none at all, empty, or blank (D4: a blank code is no code, so the status decides).</param>
  [Test, MatrixDataSource]
  public void A_429_without_an_error_code_is_rate_limited([Matrix(null, "", "   ")] string? errorCode) =>
    BankErrorClassification.Classify(HttpStatusCode.TooManyRequests, errorCode).ShouldBe(BankErrorKind.RateLimited);

  // Bank unavailable: the bank's own trouble, a result the screen offers a retry for

  /// <param name="errorCode">The bank's own error, or its own timeout.</param>
  /// <param name="status"><c>503</c>, as the bank plausibly sends it with these codes; <c>422</c> and <c>429</c>, which without the code would decide otherwise.</param>
  [Test, MatrixDataSource]
  public void The_banks_own_error_or_timeout_is_bank_unavailable(
    [Matrix("ASPSP_ERROR", "ASPSP_TIMEOUT")] string errorCode,
    [Matrix(HttpStatusCode.ServiceUnavailable, HttpStatusCode.UnprocessableEntity, HttpStatusCode.TooManyRequests)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.Unavailable);

  /// <param name="status">Server errors across the 5xx range, including one with no name, and 408.</param>
  /// <param name="errorCode">No code: none at all, empty, or blank (D4: a blank code is no code, so the status decides).</param>
  [Test, MatrixDataSource]
  public void A_5xx_or_408_without_an_error_code_is_bank_unavailable(
    [Matrix(HttpStatusCode.InternalServerError, HttpStatusCode.BadGateway, HttpStatusCode.ServiceUnavailable, HttpStatusCode.GatewayTimeout, (HttpStatusCode)599, HttpStatusCode.RequestTimeout)] HttpStatusCode status,
    [Matrix(null, "", "   ")] string? errorCode) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.Unavailable);

  // Unexpected: a bug or misconfiguration on our side, or an answer we do not know; never a result (D4)

  /// <param name="errorCode">
  /// D4's "everything else" (a wrong key or account, wrong parameters, a rejected or missing user header), a code nobody
  /// defined, and known codes spelled otherwise than the reference writes them (D4: codes match exactly).
  /// </param>
  /// <param name="status"><c>429</c> and <c>503</c>, which without a code would decide rate limited and bank unavailable.</param>
  [Test, MatrixDataSource]
  public void Any_other_error_code_is_unexpected(
    [Matrix(
      "UNAUTHORIZED_ACCESS", "ACCOUNT_DOES_NOT_EXIST", "ACCESS_DENIED", "WRONG_REQUEST_PARAMETERS", "WRONG_CONTINUATION_KEY", "DATE_FROM_IN_FUTURE",
      "PSU_HEADER_NOT_PROVIDED", "PSU_HEADER_INVALID", "NOT_A_CODE_ENABLE_BANKING_DEFINES", "aspsp_error", "aspsp_rate_limit_exceeded", "expired_session")] string errorCode,
    [Matrix(HttpStatusCode.TooManyRequests, HttpStatusCode.ServiceUnavailable)] HttpStatusCode status) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.Unexpected);

  /// <param name="status">Client errors other than <c>408</c> and <c>429</c>.</param>
  /// <param name="errorCode">No code: none at all, empty, or blank.</param>
  [Test, MatrixDataSource]
  public void Any_other_status_without_an_error_code_is_unexpected(
    [Matrix(HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden, HttpStatusCode.NotFound, HttpStatusCode.UnprocessableEntity)] HttpStatusCode status,
    [Matrix(null, "", "   ")] string? errorCode) =>
    BankErrorClassification.Classify(status, errorCode).ShouldBe(BankErrorKind.Unexpected);
}