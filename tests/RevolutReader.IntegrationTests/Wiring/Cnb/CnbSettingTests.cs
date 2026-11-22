using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Cnb;

/// <summary>
/// The <c>Cnb</c> settings (c017 design.md D4, § Public API sketch, <see cref="CnbOptions"/>) are checked as the app starts,
/// by the production wiring's own checks: the address is required, and is an absolute https address or http on a loopback
/// host; the time limit is 1 ms to 10 s. A setting that fails stops the start with a failure naming it.
/// </summary>
public sealed class CnbSettingTests {
  private const string ADDRESS = "Cnb:Address";
  private const string TIME_LIMIT = "Cnb:TimeLimit";

  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <param name="address">No value at all, or an empty one, over <c>appsettings.json</c>'s.</param>
  [Test]
  [Arguments("missing")]
  [Arguments("empty")]
  public async Task A_missing_address_stops_the_start_naming_the_setting(string address) {
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [ADDRESS] = address == "missing" ? null : string.Empty });

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(cnb.Starts);

    failure.Message.ShouldContain(nameof(CnbOptions.Address));
  }

  /// <summary>
  /// An address the CNB's client could not ask is refused at start, as the bank's is (<c>EnableBankingOptionsValidator</c>),
  /// rather than passing the start and failing every request that carries a rate (review of PR #95, finding 1): only an
  /// absolute https address, or http on a loopback host (the fake CNB's), is one the client can use.
  /// </summary>
  /// <param name="address">
  /// No scheme, which binds as a relative address; an absolute one of another scheme; plain http to a host that is not a
  /// loopback one.
  /// </param>
  [Test]
  [Arguments("api.cnb.cz")]
  [Arguments("ftp://api.cnb.cz/")]
  [Arguments("http://api.cnb.cz/")]
  public async Task An_address_neither_absolute_https_nor_http_on_a_loopback_host_stops_the_start_naming_the_setting(string address) {
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [ADDRESS] = address });

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(cnb.Starts);

    failure.Message.ShouldContain(nameof(CnbOptions.Address));
  }

  /// <summary>
  /// The address <c>appsettings.json</c> declares for production, read from the app's own file (which the build copies next
  /// to the tests), with the file's own time limit, lets the app start: the check on the address refuses no address the
  /// client can use (review of PR #95, finding 1).
  /// </summary>
  [Test]
  public async Task Productions_own_address_lets_the_app_start() {
    string? production = new ConfigurationBuilder().AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false).Build()[ADDRESS];
    production.ShouldNotBeNullOrEmpty("the address appsettings.json declares");
    using CnbOnWireMock cnb = new(new Dictionary<string, string?> { [ADDRESS] = production });

    await Should.NotThrowAsync(cnb.Starts);
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