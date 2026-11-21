using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The <c>Cnb</c> settings (c017 design.md D4, § Public API sketch, <see cref="CnbOptions"/>) are checked as the app starts,
/// by the production wiring's own checks: the address is required, and the time limit is 1 ms to 10 s. A setting that fails
/// stops the start with a failure naming it.
/// </summary>
public sealed class CnbSettingTests {
  private const string ADDRESS = "Cnb:Address";
  private const string TIME_LIMIT = "Cnb:TimeLimit";

  /// <param name="address">No value at all, or an empty one, over <c>appsettings.json</c>'s.</param>
  [Test]
  [Arguments("missing")]
  [Arguments("empty")]
  public async Task A_missing_address_stops_the_start_naming_the_setting(string address) {
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [ADDRESS] = address == "missing" ? null : string.Empty });

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(cnb.Starts);

    failure.Message.ShouldContain(nameof(CnbOptions.Address));
  }

  /// <param name="timeLimit">Zero, just over 10 s, and below zero.</param>
  [Test]
  [Arguments("00:00:00")]
  [Arguments("00:00:10.001")]
  [Arguments("-00:00:01")]
  public async Task A_time_limit_outside_1_millisecond_to_10_seconds_stops_the_start_naming_the_setting(string timeLimit) {
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [TIME_LIMIT] = timeLimit });

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(cnb.Starts);

    failure.Message.ShouldContain(nameof(CnbOptions.TimeLimit));
  }

  /// <param name="timeLimit">The least the setting allows, production's 2 s, and the most it allows.</param>
  [Test]
  [Arguments("00:00:00.001")]
  [Arguments("00:00:02")]
  [Arguments("00:00:10")]
  public async Task A_time_limit_from_1_millisecond_to_10_seconds_lets_the_app_start(string timeLimit) {
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [TIME_LIMIT] = timeLimit });

    await Should.NotThrowAsync(cnb.Starts);
  }
}