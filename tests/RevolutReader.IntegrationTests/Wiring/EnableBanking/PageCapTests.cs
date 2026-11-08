using System.Globalization;
using Microsoft.Extensions.Logging;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The page cap through the client (c006 design.md D4): a read requests at most <see cref="TransactionPages.MOST_PAGES"/>
/// pages. A bank whose 20th page still carries a key ends the read as an error after exactly 20 requests, and the line's
/// reason names the cap (D8 a). The bank here would end a page later, with a 21st page without a key, so only the cap
/// stops the read. Every page is empty, its key made up.
/// </summary>
public sealed class PageCapTests {
  private static readonly DateOnly _november1 = new(2026, 11, 1);

  [Test]
  public async Task A_bank_whose_20th_page_still_carries_a_key_ends_the_read_as_an_error_after_exactly_20_requests_and_the_line_names_the_cap() {
    using BankOnWireMock bank = new();
    bank.AnswersPagesInARow(TransactionPages.MOST_PAGES + 1);

    BankReadException error = await Should.ThrowAsync<BankReadException>(() => bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None));

    bank.RequestsReceived.ShouldBe(20, "no 21st page is requested");

    LogLine line = bank.LogLines.ShouldHaveSingleItem();

    line.Level.ShouldBe(LogLevel.Error);
    line.Values["Pages"].ShouldBe("20");
    line.Values["Reason"].ShouldBe(error.Message);
    line.Values["Reason"].ShouldNotBeNull().ShouldContain(TransactionPages.MOST_PAGES.ToString(CultureInfo.InvariantCulture));
    line.Texts().ShouldAllBe(text => !text.Contains(BankOnWireMock.KeyOfPage(21), StringComparison.Ordinal), "the line quotes no key");
  }

  /// <summary>The cap's other side, and a check of the fake's pages: 20 pages, the last without a key, are read whole.</summary>
  [Test]
  public async Task A_bank_of_exactly_20_pages_the_last_without_a_key_is_read_in_20_requests() {
    using BankOnWireMock bank = new();
    bank.AnswersPagesInARow(20);

    BankResult<Transactions> result = await bank.Account.ReadTransactions(_november1, new Unattended(), CancellationToken.None);

    result.Value.ShouldBeOfType<Transactions>();
    bank.RequestsReceived.ShouldBe(20);
    bank.LogLines.ShouldHaveSingleItem().Values["Pages"].ShouldBe("20");
  }
}