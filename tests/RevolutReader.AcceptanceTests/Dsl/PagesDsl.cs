using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>The app's pages, opened by a visitor who has not signed in (spec app-delivery).</summary>
public sealed class PagesDsl(PagesDriver driver) {
  /// <summary>The root address from the scenario.</summary>
  private const string START_PAGE = "/";

  /// <summary>The address from the scenario: outside <c>/api</c>, without a file extension, matching no file.</summary>
  private const string UNKNOWN_PAGE_ADDRESS = "/no-such-page";

  public Task<PageAnswer> OpenTheStartPage() => driver.GetPage(START_PAGE);

  public Task<PageAnswer> OpenAnUnknownPageAddress() => driver.GetPage(UNKNOWN_PAGE_ADDRESS);
}