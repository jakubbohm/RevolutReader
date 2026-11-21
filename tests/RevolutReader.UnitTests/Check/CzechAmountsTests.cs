using System.Globalization;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The notification's amounts, written as the app writes them (c014 design.md D2): euros with two decimals and a decimal
/// comma, thousands grouped by no-break spaces (U+00A0, written <c> </c> here) and a no-break space before "€"; a
/// negative balance with U+2212 for its minus (written <c>−</c>); the koruna value the balance's size at the rate,
/// rounded half up to whole koruna and grouped, with a no-break space before "Kč", as the frontend's <c>wholeCrowns</c>
/// rounds it (c010 design.md D6; <c>src/RevolutReader.Web/src/app/format.ts</c>). The cases include the board's examples
/// and the frontend's own (5.00 at 24.3 is 121.5, exactly half). Amounts are given as invariant text, since an attribute
/// cannot hold a decimal; they are made up.
/// </summary>
public sealed class CzechAmountsTests {
  /// <summary>C13's rate, koruna per euro, as the board's examples use it.</summary>
  private const string RATE = "24.3";

  /// <param name="amount">The amount in euros.</param>
  /// <param name="written">How the app writes it.</param>
  [Test]
  [Arguments("3.80", "3,80 €")]
  [Arguments("45.20", "45,20 €")]
  [Arguments("45.2", "45,20 €")] // two decimals, whatever the amount's own scale
  [Arguments("100", "100,00 €")]
  [Arguments("0", "0,00 €")]
  public void Euros_are_written_with_two_decimals_a_decimal_comma_and_a_no_break_space_before_the_euro_sign(string amount, string written) =>
    CzechAmounts.Euros(Number(amount)).ShouldBe(written);

  /// <param name="amount">The amount in euros.</param>
  /// <param name="written">How the app writes it.</param>
  [Test]
  [Arguments("999.99", "999,99 €")] // under a thousand: no group
  [Arguments("1234.56", "1 234,56 €")]
  [Arguments("1234567.89", "1 234 567,89 €")] // every thousand
  public void Euros_from_a_thousand_on_are_grouped_by_no_break_spaces(string amount, string written) =>
    CzechAmounts.Euros(Number(amount)).ShouldBe(written);

  /// <param name="amount">A negative amount in euros.</param>
  /// <param name="written">How the app writes it.</param>
  [Test]
  [Arguments("-5.00", "−5,00 €")]
  [Arguments("-1234.56", "−1 234,56 €")] // with its thousands grouped
  public void A_negative_balance_keeps_its_minus_as_U2212(string amount, string written) =>
    CzechAmounts.Euros(Number(amount)).ShouldBe(written);

  /// <param name="euros">The balance in euros.</param>
  /// <param name="rate">Koruna per euro.</param>
  /// <param name="written">How the app writes its koruna value.</param>
  [Test]
  [Arguments("45.20", RATE, "1 098 Kč")] // 1 098.36, down
  [Arguments("145.20", RATE, "3 528 Kč")] // 3 528.36, down
  [Arguments("286.40", RATE, "6 960 Kč")] // 6 959.52, up
  [Arguments("5.00", RATE, "122 Kč")] // 121.5, exactly half: up
  [Arguments("50.00", "24.31", "1 216 Kč")] // 1 215.5, exactly half: up
  [Arguments("50000", RATE, "1 215 000 Kč")] // every thousand grouped
  public void The_koruna_value_is_the_size_at_the_rate_rounded_half_up_to_whole_koruna_and_grouped(string euros, string rate, string written) =>
    CzechAmounts.WholeKoruna(Number(euros), Number(rate)).ShouldBe(written);

  /// <param name="euros">A negative balance in euros.</param>
  /// <param name="written">How the app writes its koruna value: its size, no minus.</param>
  [Test]
  [Arguments("-45.20", "1 098 Kč")]
  [Arguments("-5.00", "122 Kč")] // the size's half rounds up, as for a positive balance
  public void The_koruna_value_of_a_negative_balance_is_its_size(string euros, string written) =>
    CzechAmounts.WholeKoruna(Number(euros), Number(RATE)).ShouldBe(written);

  private static decimal Number(string text) => decimal.Parse(text, NumberStyles.Number, CultureInfo.InvariantCulture);
}