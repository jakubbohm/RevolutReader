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
}