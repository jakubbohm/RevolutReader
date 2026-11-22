using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;
using RevolutReader.UnitTests.Configuration;
using Shouldly;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The CNB settings are checked at start-up (c017 design.md D1, D4; configuration.md § Binding): the address is required
/// and is an absolute https address, or plain http on a loopback host (the test fakes'); the time limit lies between 1
/// millisecond and 10 seconds. A failure names the setting, never its value: a failure of the settings' own rules is the
/// standard data-annotation failure, naming the settings class and the setting (the owner's decision on #97, 2026-11-22),
/// and the validator's address check opens its sentence with the setting's full name, as the operator sets it (#97). Each
/// test runs the checks the app runs at start, through the koruna rate's own registration
/// (<see cref="RateRegistration.AddKorunaRates"/>, from an in-memory configuration): the settings' data annotations and
/// <see cref="CnbOptionsValidator"/>, however those checks are built. The addresses are made up, but for production's own,
/// the CNB's public one.
/// </summary>
public sealed class CnbOptionsTests {
  /// <summary>The settings' section, as the configuration names it (D1), written out, so a renamed setting fails here.</summary>
  private const string SECTION = "Cnb";

  /// <summary>What each kind of failure of the settings' own rules says, besides the setting's name; the time limit's range says its limits.</summary>
  private const string SAYS_REQUIRED = "required";

  /// <summary>The time limit's limits, both allowed, as a TimeSpan setting reads (D4).</summary>
  private const string SHORTEST_TIME_LIMIT = "00:00:00.001";
  private const string LONGEST_TIME_LIMIT = "00:00:10";

  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <summary>Production's address and time limit, as <c>appsettings.json</c> declares them (D1, D4).</summary>
  private static readonly Uri _address = new("https://api.cnb.cz");
  private static readonly TimeSpan _timeLimit = TimeSpan.FromSeconds(2);

  /// <param name="variant">Complete settings, as production's, or with one value at an edge the rules allow.</param>
  [Test]
  [Arguments("production's address and time limit")]
  [Arguments("plain http on a loopback address with a port, as the fakes'")]
  [Arguments("plain http on localhost")]
  [Arguments("plain http on the IPv6 loopback address")]
  [Arguments("the shortest time limit, 1 millisecond")]
  [Arguments("the longest time limit, 10 seconds")]
  public void A_complete_set_of_cnb_settings_passes_validation(string variant) {
    CnbOptions settings = variant switch {
      "production's address and time limit" => Settings(),
      "plain http on a loopback address with a port, as the fakes'" => Settings(address: new Uri("http://127.0.0.1:5005")),
      "plain http on localhost" => Settings(address: new Uri("http://localhost:5005")),
      "plain http on the IPv6 loopback address" => Settings(address: new Uri("http://[::1]:5005")),
      "the shortest time limit, 1 millisecond" => Settings(timeLimit: TimeSpan.Parse(SHORTEST_TIME_LIMIT, CultureInfo.InvariantCulture)),
      "the longest time limit, 10 seconds" => Settings(timeLimit: TimeSpan.Parse(LONGEST_TIME_LIMIT, CultureInfo.InvariantCulture)),
      _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, "Not a known case."),
    };

    Failures(settings).ShouldBeEmpty();
  }

  /// <summary>
  /// The settings the app's own <c>appsettings.json</c> declares under <c>Cnb</c>, read from the file as the app reads its
  /// section: a typo in the file fails here, not at the app's start.
  /// </summary>
  [Test]
  public void The_cnb_settings_declared_in_appsettings_json_pass_validation() =>
    Failures(new ConfigurationBuilder().AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false).Build()).ShouldBeEmpty();

  /// <summary>An address left out of the configuration is required: the failure names it and says so; the validator's own check fails too.</summary>
  [Test]
  public void A_missing_address_fails_validation_naming_it_as_required() =>
    Failures(Settings(), leftOut: nameof(CnbOptions.Address)).ShouldHaveDataAnnotationFailure<CnbOptions>(nameof(CnbOptions.Address), SAYS_REQUIRED);

  /// <summary>
  /// An address the CNB's client could not ask is refused at start (review of PR #95, finding 1): only an absolute https
  /// address, or plain http on a loopback host, is one the client can use. The validator's failure names the setting by
  /// its full name, as the operator sets it (<c>Cnb:Address</c>, or <c>Cnb__Address</c> in the environment, #97), never
  /// by the settings class's name, and never holds the value.
  /// </summary>
  /// <param name="address">Not an absolute https address, nor plain http on a loopback host (D1).</param>
  [Test]
  [Arguments("api.cnb.cz")] // no scheme: binds as a relative address
  [Arguments("ftp://api.cnb.cz/")] // neither https nor http
  [Arguments("http://api.cnb.cz/")] // plain http on a host that is not loopback
  [Arguments("http://10.0.0.4:5005")] // plain http on an address of the private network
  [Arguments("http://localhost.example.com:5005")] // plain http on a host that only starts like this machine's name
  public void An_address_neither_absolute_https_nor_http_on_a_loopback_host_fails_validation_naming_the_setting_in_full_never_its_value(string address) {
    IReadOnlyList<string> failures = Failures(Settings(address: new Uri(address, UriKind.RelativeOrAbsolute)));

    ShouldNameInFull(failures, "Cnb:Address");
    failures.ShouldAllBe(failure => !failure.Contains(address, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <param name="timeLimit">No time at all, one tick short of 1 millisecond, one tick over 10 seconds, and below zero, as a TimeSpan setting reads.</param>
  [Test]
  [Arguments("00:00:00")]
  [Arguments("00:00:00.0009999")]
  [Arguments("00:00:10.0000001")]
  [Arguments("-00:00:01")]
  public void A_time_limit_outside_1_millisecond_to_10_seconds_fails_validation_naming_both_limits(string timeLimit) =>
    Failures(Settings(timeLimit: TimeSpan.Parse(timeLimit, CultureInfo.InvariantCulture)))
      .ShouldHaveDataAnnotationFailure<CnbOptions>(nameof(CnbOptions.TimeLimit), SHORTEST_TIME_LIMIT, LONGEST_TIME_LIMIT);

  /// <summary>
  /// A failure of the settings' own rules is the standard data-annotation failure (the owner's decision on #97, 2026-11-22):
  /// it names the settings class and the setting (<c>'CnbOptions' members: 'TimeLimit'</c>), then says what is wrong, the
  /// time limit outside its range by both limits, and never holds the value.
  /// </summary>
  /// <param name="setting">Each setting with a rule of its own, broken by that rule: the address left out, the time limit outside its range.</param>
  [Test]
  [Arguments(nameof(CnbOptions.Address))]
  [Arguments(nameof(CnbOptions.TimeLimit))]
  public void An_invalid_setting_fails_validation_with_a_message_naming_its_settings_class_and_member_never_its_value(string setting) {
    (CnbOptions Settings, string? LeftOut, string? Value, string[] Says) invalid = setting switch {
      nameof(CnbOptions.Address) => (Settings(), nameof(CnbOptions.Address), null, [SAYS_REQUIRED]),
      nameof(CnbOptions.TimeLimit) => (Settings(timeLimit: TimeSpan.FromMinutes(1)), null, "00:01:00", [SHORTEST_TIME_LIMIT, LONGEST_TIME_LIMIT]),
      _ => throw new ArgumentOutOfRangeException(nameof(setting), setting, "Not a setting with a rule of its own."),
    };

    IReadOnlyList<string> failures = Failures(invalid.Settings, invalid.LeftOut);

    failures.ShouldHaveDataAnnotationFailure<CnbOptions>(setting, invalid.Says);

    if (invalid.Value is { } value)
      failures.ShouldAllBe(failure => !failure.Contains(value, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>Complete, valid settings, as production's, except for the values given.</summary>
  private static CnbOptions Settings(Uri? address = null, TimeSpan? timeLimit = null) => new() {
    Address = address ?? _address,
    TimeLimit = timeLimit ?? _timeLimit,
  };

  /// <summary>
  /// Every failure message of the start-up checks on <paramref name="settings"/>, as the app runs them: the settings
  /// written to the configuration under their real names, all but <paramref name="leftOut"/>, the address as written and
  /// the time limit as a TimeSpan setting reads, then checked as <see cref="Failures(IConfiguration)"/> does.
  /// </summary>
  /// <param name="settings">The settings to write to the configuration.</param>
  /// <param name="leftOut">A setting's name (the property's) to leave out of the configuration, or <see langword="null"/>.</param>
  private static IReadOnlyList<string> Failures(CnbOptions settings, string? leftOut = null) {
    Dictionary<string, string?> values = new(StringComparer.Ordinal) {
      [$"{SECTION}:Address"] = settings.Address.OriginalString,
      [$"{SECTION}:TimeLimit"] = settings.TimeLimit.ToString("c", CultureInfo.InvariantCulture),
    };

    if (leftOut is not null && !values.Remove($"{SECTION}:{leftOut}"))
      throw new ArgumentOutOfRangeException(nameof(leftOut), leftOut, "Not a setting the configuration holds.");

    return Failures(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
  }

  /// <summary>
  /// Every failure message of the start-up checks on the <c>Cnb</c> settings <paramref name="configuration"/> holds, as the
  /// app runs them: bound and checked through <see cref="RateRegistration.AddKorunaRates"/>, so the data annotations and
  /// the validator. None when the settings resolve.
  /// </summary>
  private static IReadOnlyList<string> Failures(IConfiguration configuration) {
    ServiceCollection services = new();
    services.AddSingleton(configuration);
    services.AddKorunaRates();

    using ServiceProvider provider = services.BuildServiceProvider();

    try {
      _ = provider.GetRequiredService<IOptions<CnbOptions>>().Value;

      return [];
    }
    catch (OptionsValidationException refused) {
      return [.. refused.Failures];
    }
  }

  /// <summary>
  /// Asserts that <paramref name="failures"/> hold a failure of the validator's own check naming <paramref name="setting"/>
  /// by its full name, as the operator sets it (#97): the message opens with the name and goes straight on to say what is
  /// wrong (<c>Cnb:Address is not …</c>), where a failure of the settings' own rules opens as the standard data-annotation
  /// failure, so only the validator's failure passes. No failure may name a setting by the settings class's name instead
  /// (<c>CnbOptions.Address</c>), which the operator cannot set.
  /// </summary>
  /// <param name="failures">The failure messages of the start-up checks.</param>
  /// <param name="setting">The setting's full name: the section, ":" and the setting.</param>
  private static void ShouldNameInFull(IReadOnlyList<string> failures, string setting) {
    failures.ShouldContain(
      failure => failure.StartsWith($"{setting} ", StringComparison.Ordinal),
      $"a failure opening with \"{setting} \"; the failures were: {string.Join(" | ", failures)}");
    failures.ShouldAllBe(
      failure => !failure.Contains($"{nameof(CnbOptions)}.", StringComparison.Ordinal),
      "no failure may name a setting by the settings class's name");
  }
}