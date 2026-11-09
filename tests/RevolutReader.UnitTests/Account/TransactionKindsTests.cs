using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// A transaction's kind from the bank's type code (c010 design.md D4; spec account-transactions, "What a transaction
/// says"): the five codes Revolut uses in the history (counts only, design.md § Context) name their kinds; a code
/// containing <c>REFUND</c>, in any letter case, is a refund (Revolut's API reference lists <c>REFUND</c> and
/// <c>CARD_REFUND</c>; the history holds none, D4c); anything else, a missing code too, is other. And whether a code looks
/// like one, so the log may quote it: capitals, digits and underscores, 1 to 40 of them (D4c). The codes are written out:
/// they are what the bank sends.
/// </summary>
public sealed class TransactionKindsTests {
  [Test]
  [Arguments("CARD_PAYMENT", TransactionKind.CardPayment)]
  [Arguments("TOPUP", TransactionKind.TopUp)]
  [Arguments("TRANSFER", TransactionKind.Transfer)]
  [Arguments("ATM", TransactionKind.CashWithdrawal)]
  [Arguments("EXCHANGE", TransactionKind.Exchange)]
  public void CARD_PAYMENT_TOPUP_TRANSFER_ATM_and_EXCHANGE_are_a_card_payment_a_top_up_a_transfer_a_cash_withdrawal_and_an_exchange(string typeCode, TransactionKind kind) =>
    TransactionKinds.Of(typeCode).ShouldBe(kind);

  /// <param name="typeCode">The two codes the reference lists, the word in small letters, in mixed case inside a longer code, and after another known code's name.</param>
  [Test]
  [Arguments("CARD_REFUND")]
  [Arguments("REFUND")]
  [Arguments("refund")]
  [Arguments("Card_Refund_Reversal")]
  [Arguments("ATM_REFUND")]
  public void A_code_containing_REFUND_is_a_refund_in_any_letter_case(string typeCode) =>
    TransactionKinds.Of(typeCode).ShouldBe(TransactionKind.Refund);

  /// <param name="typeCode">A code the app does not know, part of a known code, a known code with more after it, and an empty code.</param>
  [Test]
  [Arguments("CASHBACK")]
  [Arguments("CARD")]
  [Arguments("CARD_PAYMENTS")]
  [Arguments("")]
  public void Any_other_code_is_other(string typeCode) =>
    TransactionKinds.Of(typeCode).ShouldBe(TransactionKind.Other);

  [Test]
  public void A_missing_code_is_other() =>
    TransactionKinds.Of(null).ShouldBe(TransactionKind.Other);

  /// <param name="typeCode">Codes as Revolut writes them, one character, a digit, an underscore alone, and exactly 40 capitals.</param>
  [Test]
  [Arguments("CARD_PAYMENT")]
  [Arguments("ATM2")]
  [Arguments("A")]
  [Arguments("0")]
  [Arguments("_")]
  [Arguments("40 capitals")]
  public void Capitals_digits_and_underscores_up_to_40_characters_look_like_a_code(string typeCode) =>
    TransactionKinds.LooksLikeACode(typeCode == "40 capitals" ? new string('A', 40) : typeCode).ShouldBeTrue();

  /// <param name="typeCode">
  /// Small letters, a space, a hyphen, a capital outside A to Z, 41 capitals, nothing at all, and a code with a line break
  /// at its end, which a pattern anchored with <c>$</c> alone would let through into a log line.
  /// </param>
  [Test]
  [Arguments("small letters")]
  [Arguments("a space")]
  [Arguments("a hyphen")]
  [Arguments("a capital outside A to Z")]
  [Arguments("41 capitals")]
  [Arguments("empty")]
  [Arguments("a line break at its end")]
  public void Any_other_character_or_more_than_40_does_not_look_like_a_code(string typeCode) {
    string code = typeCode switch {
      "small letters" => "card_payment",
      "a space" => "CARD PAYMENT",
      "a hyphen" => "CARD-PAYMENT",
      "a capital outside A to Z" => "PLATBA_Č",
      "41 capitals" => new string('A', 41),
      "empty" => string.Empty,
      "a line break at its end" => "CARD_PAYMENT\n",
      _ => throw new ArgumentOutOfRangeException(nameof(typeCode), typeCode, "Not a known case."),
    };

    TransactionKinds.LooksLikeACode(code).ShouldBeFalse();
  }
}