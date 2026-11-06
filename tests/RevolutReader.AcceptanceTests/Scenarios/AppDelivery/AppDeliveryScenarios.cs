using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.AppDelivery;

public sealed class AppDeliveryScenarios : AcceptanceTest {
  [Test, Scenario("app-delivery", "The start page opens at the root address")]
  public async Task The_start_page_opens_at_the_root_address() => (await Pages.OpenTheStartPage()).ShouldBe(PageAnswer.TheApp);

  [Test, Scenario("app-delivery", "An unknown page address opens the app")]
  public async Task An_unknown_page_address_opens_the_app() => (await Pages.OpenAnUnknownPageAddress()).ShouldBe(PageAnswer.TheApp);
}