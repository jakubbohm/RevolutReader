using System.Globalization;
using RevolutReader.Api.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The bank's text as the app shows it (c010 design.md D4b; spec account-transactions, "What a transaction says"): the
/// bank's lines in their order, without blank lines and without any line that repeats the counterparty, compared ignoring
/// letter case, accents and spacing; each kept line with its runs of spaces collapsed to one and none at its ends. It is
/// the design system's <c>descriptionLines</c>, cut on the server: 100 of the 116 transactions in the history carry a
/// line that only repeats the counterparty's name, often in capitals without accents ("PEKARNA U LIPY"). The names are
/// the spec's made-up ones.
/// </summary>
public sealed class TransactionTextTests {
  private const string BAKERY = "Pekárna U Lípy";

  /// <summary>Wherever the line stands, and however often: every line equal to the counterparty goes, the others keep their order.</summary>
  [Test]
  public void A_line_equal_to_the_counterparty_is_left_out_of_the_details() =>
    TransactionText.Details(BAKERY, [BAKERY, "Praha 2", BAKERY, "Reklamace"]).ShouldBe(["Praha 2", "Reklamace"]);

  /// <param name="differs">
  /// How the line differs from the counterparty: in capitals without accents, as the bank writes it; in small letters; without
  /// its accents; with other spacing (runs of spaces, and spaces at its ends); and in capitals holding an I on a machine
  /// whose culture lower-cases I to a dotless ı (Turkish), so the comparison must not depend on the machine's culture.
  /// </param>
  [Test]
  [Arguments("in capitals without accents")]
  [Arguments("in small letters")]
  [Arguments("without its accents")]
  [Arguments("with other spacing")]
  [Arguments("in capitals with an I, on a Turkish machine")]
  public void A_line_repeating_the_counterparty_in_other_letter_case_without_its_accents_or_with_other_spacing_is_left_out(string differs) {
    (string counterparty, string line, string culture) = differs switch {
      "in capitals without accents" => (BAKERY, "PEKARNA U LIPY", "cs-CZ"),
      "in small letters" => (BAKERY, "pekárna u lípy", "cs-CZ"),
      "without its accents" => (BAKERY, "Pekarna U Lipy", "cs-CZ"),
      "with other spacing" => (BAKERY, "  Pekárna   U  Lípy ", "cs-CZ"),
      "in capitals with an I, on a Turkish machine" => ("Knihkupectví Luxor", "KNIHKUPECTVI LUXOR", "tr-TR"),
      _ => throw new ArgumentOutOfRangeException(nameof(differs), differs, "Not a known case."),
    };
    CultureInfo original = CultureInfo.CurrentCulture;

    try {
      CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);

      TransactionText.Details(counterparty, [line, "Praha 2"]).ShouldBe(["Praha 2"]);
    }
    finally {
      CultureInfo.CurrentCulture = original;
    }
  }

  /// <summary>Empty, spaces only, a tab: nothing to read.</summary>
  [Test]
  public void Blank_lines_are_left_out() =>
    TransactionText.Details(BAKERY, ["", "Praha 2", "   ", "\t", "Reklamace"]).ShouldBe(["Praha 2", "Reklamace"]);

  /// <summary>Inside a line a run of spaces becomes one; at its ends, as in the design system's rule, they go.</summary>
  [Test]
  public void Runs_of_spaces_inside_a_kept_line_collapse_to_one() =>
    TransactionText.Details(BAKERY, ["Praha    2", "  Bankomat   Můstek  "]).ShouldBe(["Praha 2", "Bankomat Můstek"]);

  /// <param name="counterparty">None at all, or one of spaces only: there is no name to compare with.</param>
  [Test]
  [Arguments(null)]
  [Arguments("   ")]
  public void Without_a_counterparty_every_line_that_is_not_blank_stays(string? counterparty) =>
    TransactionText.Details(counterparty, [BAKERY, "", "Praha 2"]).ShouldBe([BAKERY, "Praha 2"]);

  /// <summary>Only a line that is nothing but the name goes; the name among other words is the bank saying more.</summary>
  [Test]
  public void A_line_that_holds_the_counterpartys_name_among_other_words_stays() =>
    TransactionText.Details(BAKERY, ["Pekárna U Lípy Praha 2", "PEKARNA U LIPY s.r.o."]).ShouldBe(["Pekárna U Lípy Praha 2", "PEKARNA U LIPY s.r.o."]);
}