using System.Globalization;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The wait before a first retry (<c>EnableBanking:RetryDelay</c>, c008 design.md D7) is checked as the app starts, by the
/// production wiring's own checks: 0 to 5 s. A wait outside that stops the start with a failure naming the setting.
/// </summary>
public sealed class RetryDelaySettingTests {
  /// <param name="retryDelay">Just over 5 s, well over it, and below zero.</param>
  [Test]
  [Arguments("00:00:05.001")]
  [Arguments("00:00:06")]
  [Arguments("-00:00:01")]
  public async Task A_wait_outside_0_to_5_seconds_stops_the_start_naming_the_setting(string retryDelay) {
    using BankOnWireMock bank = new(retryDelay: TimeSpan.Parse(retryDelay, CultureInfo.InvariantCulture));

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(bank.Starts);

    failure.Message.ShouldContain(nameof(EnableBankingOptions.RetryDelay));
  }

  /// <param name="retryDelay">The tests' zero, production's 0.8 s, and the most the setting allows.</param>
  [Test]
  [Arguments("00:00:00")]
  [Arguments("00:00:00.8")]
  [Arguments("00:00:05")]
  public async Task A_wait_from_0_to_5_seconds_lets_the_app_start(string retryDelay) {
    using BankOnWireMock bank = new(retryDelay: TimeSpan.Parse(retryDelay, CultureInfo.InvariantCulture));

    await Should.NotThrowAsync(bank.Starts);
  }
}