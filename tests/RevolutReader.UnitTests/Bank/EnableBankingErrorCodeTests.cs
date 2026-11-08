using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// The shape of an Enable Banking error code (c006 design.md D7): a capital letter, then capital letters and underscores,
/// at most 64 characters in all, compared ordinally, so only ASCII A to Z count as capitals. A value of that shape is a
/// code; anything else is not, so it is never quoted and the HTTP status decides (D3). No digits, so an account or session
/// id written in capitals without its dashes cannot pass. The ids and texts here are made up.
/// </summary>
public sealed class EnableBankingErrorCodeTests {
  /// <param name="code">
  /// Every code of the <c>ErrorCode</c> enum in Enable Banking's OpenAPI file (43 codes, downloaded 2026-11-07), the
  /// longest <c>PAYMENT_SUBMISSION_NOT_SUPPORTED</c> with 32 characters.
  /// </param>
  [Test]
  [Arguments("ACCESS_DENIED")]
  [Arguments("ACCOUNT_DOES_NOT_EXIST")]
  [Arguments("ALREADY_AUTHORIZED")]
  [Arguments("ASPSP_ACCOUNT_NOT_ACCESSIBLE")]
  [Arguments("ASPSP_ERROR")]
  [Arguments("ASPSP_TIMEOUT")]
  [Arguments("ASPSP_RATE_LIMIT_EXCEEDED")]
  [Arguments("AUTHORIZATION_NOT_PROVIDED")]
  [Arguments("CLOSED_SESSION")]
  [Arguments("DATE_TO_WITHOUT_DATE_FROM")]
  [Arguments("DATE_FROM_IN_FUTURE")]
  [Arguments("EXPIRED_AUTHORIZATION_CODE")]
  [Arguments("EXPIRED_SESSION")]
  [Arguments("INVALID_ACCOUNT_ID")]
  [Arguments("INVALID_HOST")]
  [Arguments("UNAUTHORIZED_IP")]
  [Arguments("NO_ACCOUNTS_ADDED")]
  [Arguments("PAYMENT_NOT_FOUND")]
  [Arguments("PSU_HEADER_NOT_PROVIDED")]
  [Arguments("PSU_HEADER_INVALID")]
  [Arguments("REDIRECT_URI_NOT_ALLOWED")]
  [Arguments("REVOKED_SESSION")]
  [Arguments("SESSION_DOES_NOT_EXIST")]
  [Arguments("UNAUTHORIZED_ACCESS")]
  [Arguments("UNTRUSTED_PAYMENT_PARTY")]
  [Arguments("WEBHOOK_URI_NOT_ALLOWED")]
  [Arguments("WRONG_ASPSP_PROVIDED")]
  [Arguments("WRONG_AUTHORIZATION_CODE")]
  [Arguments("WRONG_DATE_INTERVAL")]
  [Arguments("WRONG_CREDENTIALS_PROVIDED")]
  [Arguments("WRONG_REQUEST_PARAMETERS")]
  [Arguments("WRONG_SESSION_STATUS")]
  [Arguments("WRONG_TRANSACTIONS_PERIOD")]
  [Arguments("WRONG_CONTINUATION_KEY")]
  [Arguments("TRANSACTION_DOES_NOT_EXIST")]
  [Arguments("PAYMENT_LIMIT_EXCEEDED")]
  [Arguments("ASPSP_PAYMENT_NOT_ACCESSIBLE")]
  [Arguments("INVALID_PAYMENT")]
  [Arguments("ASPSP_PSU_ACTION_REQUIRED")]
  [Arguments("PAYMENT_NOT_FINALIZED")]
  [Arguments("PAYMENT_SUBMISSION_NOT_SUPPORTED")]
  [Arguments("PAYMENT_NOT_AUTHORIZED")]
  [Arguments("PAYMENT_SUBMISSION_NOT_DEFERRED")]
  public void Enable_Bankings_codes_have_the_code_shape(string code) =>
    EnableBankingErrorCode.HasCodeShape(code).ShouldBeTrue();

  /// <param name="length">64, the most a code may have; 65, one more.</param>
  /// <param name="hasShape">Whether a value of that length, of capital letters and underscores only, has the code shape.</param>
  [Test]
  [Arguments(64, true)]
  [Arguments(65, false)]
  public void A_value_of_64_capital_letters_and_underscores_has_the_code_shape_one_of_65_does_not(int length, bool hasShape) {
    string value = string.Concat(Enumerable.Repeat("CODE_", 13))[..length];

    EnableBankingErrorCode.HasCodeShape(value).ShouldBe(hasShape);
  }

  /// <param name="value">
  /// Shaped like a code but for one thing: a lower-case letter; a digit, also in a made-up id written in capitals without
  /// its dashes; a space, also at the end or as a gateway's text; a line feed at the end (which a regular expression's
  /// <c>$</c> lets through); a slash; a colon, also in a path like the audit's probe; a capital outside A to Z (É).
  /// </param>
  [Test]
  [Arguments("EXPIRED_session")]
  [Arguments("ASPSP_ERROR_2")]
  [Arguments("9B7E2C4AD1F04E6A8C3B5D7F1A2E4C6B")]
  [Arguments("EXPIRED SESSION")]
  [Arguments("EXPIRED_SESSION ")]
  [Arguments("Service Unavailable")]
  [Arguments("EXPIRED_SESSION\n")]
  [Arguments("NOT_FOUND/ACCOUNTS")]
  [Arguments("NOT_FOUND:ACCOUNTS")]
  [Arguments("Not found: /accounts/9b7e2c4a-d1f0-4e6a-8c3b-5d7f1a2e4c6b/balances")]
  [Arguments("ASPSP_ÉRROR")]
  public void A_value_with_a_lower_case_letter_a_digit_a_space_a_slash_or_a_colon_does_not_have_the_code_shape(string value) =>
    EnableBankingErrorCode.HasCodeShape(value).ShouldBeFalse();

  /// <param name="value">A leading underscore before a code; an empty value; no value at all.</param>
  [Test]
  [Arguments("_EXPIRED_SESSION")]
  [Arguments("")]
  [Arguments(null)]
  public void A_value_starting_with_an_underscore_an_empty_value_and_no_value_do_not_have_the_code_shape(string? value) =>
    EnableBankingErrorCode.HasCodeShape(value).ShouldBeFalse();
}