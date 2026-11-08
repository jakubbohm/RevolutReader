using System.Net;
using Microsoft.Extensions.Logging;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The reason in a read's one log line (c006 design.md D8 a, D6): for an unexpected end, the
/// <see cref="BankReadException"/>'s message (fixed texts that quote nothing, c004 design.md D5); for any other exception
/// that ends a read, only its type name, the line at <c>Error</c>, and the exception passes on unchanged; <c>none</c> for
/// every other end. Every value is made up.
/// </summary>
public sealed class LogLineReasonTests {
  /// <summary>The outcome of an unexpected end, as the line says it.</summary>
  private const string UNEXPECTED = "an answer no case fits, or one that cannot be read";

  /// <summary>An available balance, in the Mock ASPSP capture's shape.</summary>
  private const string BALANCES = """{ "balances": [{ "name": "made up", "balance_amount": { "currency": "EUR", "amount": "1234.56" }, "balance_type": "ITAV" }] }""";

  /// <summary>One page without transactions, and no next page.</summary>
  private const string LAST_PAGE = """{ "transactions": [], "continuation_key": null }""";

  /// <summary>Written from the API reference: the Mock ASPSP cannot expire a session on demand.</summary>
  private const string EXPIRED_SESSION = """{ "code": 422, "message": "Session has expired", "error": "EXPIRED_SESSION", "detail": null }""";

  /// <summary>The Mock ASPSP's answer for an unknown account: an error code no case fits.</summary>
  private const string UNKNOWN_ACCOUNT = """{ "code": 404, "message": "No account found matching provided id", "error": "ACCOUNT_DOES_NOT_EXIST", "detail": null }""";

  /// <summary>A booked payment with a minus on its amount (c006 design.md D2), in the Mock ASPSP capture's shape.</summary>
  private const string NEGATIVE_AMOUNT_PAGE = """
    {
      "transactions": [
        {
          "entry_reference": "e-101",
          "transaction_amount": { "currency": "EUR", "amount": "-12.30" },
          "creditor": { "name": "Pekárna U Lípy" },
          "credit_debit_indicator": "DBIT",
          "status": "BOOK",
          "booking_date": "2026-11-03",
          "value_date": "2026-11-03",
          "transaction_date": null,
          "remittance_information": ["Pekárna U Lípy"]
        }
      ],
      "continuation_key": null
    }
    """;

  private static readonly DateOnly _november1 = new(2026, 11, 1);

  /// <param name="read">The balance read or the transactions read.</param>
  /// <param name="outcome">How the read ends, as its line says it: every end that is not unexpected.</param>
  [Test]
  [Arguments("balance", "read")]
  [Arguments("balance", "access expired")]
  [Arguments("balance", "rate limited")]
  [Arguments("balance", "bank unavailable")]
  [Arguments("balance", "cancelled by the caller")]
  [Arguments("transactions", "read")]
  [Arguments("transactions", "access expired")]
  [Arguments("transactions", "rate limited")]
  [Arguments("transactions", "bank unavailable")]
  [Arguments("transactions", "cancelled by the caller")]
  public async Task Every_end_that_is_not_unexpected_gives_the_reason_none(string read, string outcome) {
    using BankOnWireMock bank = new();
    using CancellationTokenSource caller = new();

    switch (outcome) {
      case "read":
        bank.Answers(HttpStatusCode.OK, SuccessFor(read));
        break;
      case "access expired":
        bank.Answers(HttpStatusCode.UnprocessableEntity, EXPIRED_SESSION);
        break;
      case "rate limited":
        bank.Answers(HttpStatusCode.TooManyRequests, "");
        break;
      case "bank unavailable":
        bank.Answers(HttpStatusCode.ServiceUnavailable, "");
        break;
      case "cancelled by the caller":
        bank.Answers(HttpStatusCode.OK, SuccessFor(read));
        await caller.CancelAsync();
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Not a known case.");
    }

    try {
      await Read(bank, read, new Unattended(), caller.Token);
    }
    catch (OperationCanceledException) when (caller.IsCancellationRequested) {
      // The caller's cancellation passes on; its line is what counts here.
    }

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Values["Outcome"].ShouldBe(outcome);
    line.Values["Reason"].ShouldBe("none");
  }

  /// <param name="read">The balance read or the transactions read.</param>
  /// <param name="answer">An answer that ends the read as a <see cref="BankReadException"/>: an error code no case fits, or a negative amount.</param>
  [Test]
  [Arguments("balance", "an error code no case fits")]
  [Arguments("transactions", "an error code no case fits")]
  [Arguments("transactions", "a negative amount")]
  public async Task An_unexpected_end_gives_the_errors_message_as_the_reason(string read, string answer) {
    using BankOnWireMock bank = new();

    switch (answer) {
      case "an error code no case fits":
        bank.Answers(HttpStatusCode.NotFound, UNKNOWN_ACCOUNT);
        break;
      case "a negative amount":
        bank.Answers(HttpStatusCode.OK, NEGATIVE_AMOUNT_PAGE);
        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(answer), answer, "Not a known case.");
    }

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => Read(bank, read, new Unattended(), CancellationToken.None));

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Level.ShouldBe(LogLevel.Error);
    line.Values["Outcome"].ShouldBe(UNEXPECTED);
    line.Values["Reason"].ShouldBe(error.Message);
    line.Texts().ShouldAllBe(text => !text.Contains(bank.AccountId, StringComparison.OrdinalIgnoreCase) && !text.Contains("12.30", StringComparison.Ordinal), "the line quotes neither the account id nor an amount");
  }

  /// <summary>
  /// An empty <see cref="ReadTrigger"/> is a programming error at the caller: building the user headers throws (as
  /// <see cref="PsuHeaders.For"/> does when called directly), before anything is sent. The read still writes its line, at
  /// <c>Error</c> and with only the exception's type name as the reason, then the same exception passes on (D6).
  /// </summary>
  /// <param name="read">The balance read or the transactions read.</param>
  [Test]
  [Arguments("balance")]
  [Arguments("transactions")]
  public async Task Another_exception_ends_the_read_unchanged_after_a_line_at_error_naming_only_its_type(string read) {
    Exception direct = Should.Throw<Exception>(() => PsuHeaders.For(default));

    using BankOnWireMock bank = new();
    bank.Answers(HttpStatusCode.OK, SuccessFor(read));

    Exception thrown = await Should.ThrowAsync<Exception>(() => Read(bank, read, default, CancellationToken.None));

    thrown.ShouldNotBeOfType<BankReadException>();
    thrown.GetType().ShouldBe(direct.GetType(), "the exception passes on, not wrapped or replaced");
    thrown.Message.ShouldBe(direct.Message);
    bank.RequestsReceived.ShouldBe(0, "nothing is sent");

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Level.ShouldBe(LogLevel.Error);
    line.Values["Outcome"].ShouldBe(UNEXPECTED);
    line.Values["Reason"].ShouldBe(thrown.GetType().Name);
  }

  /// <summary>A success answer the read takes in full: an available balance, or a last page without transactions.</summary>
  private static string SuccessFor(string read) => read switch {
    "balance" => BALANCES,
    "transactions" => LAST_PAGE,
    _ => throw new ArgumentOutOfRangeException(nameof(read), read, "Not a known read."),
  };

  /// <summary>The balance read, or the transactions read from 1 November, for <paramref name="trigger"/>.</summary>
  private static Task Read(BankOnWireMock bank, string read, ReadTrigger trigger, CancellationToken cancellationToken) => read switch {
    "balance" => bank.Account.ReadBalance(trigger, cancellationToken),
    "transactions" => bank.Account.ReadTransactions(_november1, trigger, cancellationToken),
    _ => throw new ArgumentOutOfRangeException(nameof(read), read, "Not a known read."),
  };
}