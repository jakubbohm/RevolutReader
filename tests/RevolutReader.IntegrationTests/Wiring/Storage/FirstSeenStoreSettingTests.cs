using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The <c>FirstSeenTimes</c> section is checked as the app starts (c018 design.md D3, D9, tasks.md 5.3), as the
/// <c>KorunaRates</c> section is: its table name is required and must be one Table Storage accepts, 3 to 63 letters (A to
/// Z) and digits starting with a letter, so a wrong name stops the start instead of failing the first page read. The
/// failure is the standard data-annotation one, naming the settings class and the setting, never its value. Each test
/// starts a host holding only the store's registration (<see cref="StorageRegistration.AddFirstSeenStore"/>; its checks
/// need no tables client), over the app's own <c>appsettings.json</c>, which the build copies next to the tests. Written
/// by the implementer in wiring, as an adapter's settings test.
/// </summary>
public sealed class FirstSeenStoreSettingTests {
  /// <summary>The setting, as the configuration names it, written out, so a renamed setting fails here.</summary>
  private const string TABLE_NAME = "FirstSeenTimes:TableName";

  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <param name="tableName">No name, or a name Table Storage refuses: too short or too long, not starting with a letter, or holding something other than letters and digits.</param>
  [Test]
  [Arguments("left out")]
  [Arguments("empty")]
  [Arguments("two characters")]
  [Arguments("64 characters")]
  [Arguments("starting with a digit")]
  [Arguments("with a hyphen")]
  [Arguments("with a letter outside A to Z")]
  public async Task A_table_name_Table_Storage_refuses_stops_the_start_naming_the_setting_never_its_value(string tableName) {
    string? name = tableName switch {
      "left out" => null,
      "empty" => string.Empty,
      "two characters" => "fs",
      "64 characters" => $"f{new string('x', 63)}",
      "starting with a digit" => "1firstseentimes",
      "with a hyphen" => "first-seen-times",
      "with a letter outside A to Z" => "časyprvníhočtení",
      _ => throw new ArgumentOutOfRangeException(nameof(tableName), tableName, "Not a known case."),
    };

    OptionsValidationException failure = await Should.ThrowAsync<OptionsValidationException>(() => Starts(name), "the start fails");

    failure.ShouldSatisfyAllConditions(
      () => failure.Failures.ShouldContain(message => message.Contains($"'{nameof(FirstSeenStoreOptions)}' members: '{nameof(FirstSeenStoreOptions.TableName)}'", StringComparison.Ordinal), "a failure naming the settings class and the setting"),
      () => failure.Failures.ShouldAllBe(message => string.IsNullOrEmpty(name) || !message.Contains(name, StringComparison.Ordinal), "no failure quotes the value"));
  }

  /// <summary>The table name <c>appsettings.json</c> declares, <c>firstseentimes</c>, lets the app start.</summary>
  [Test]
  public async Task The_declared_table_name_lets_the_app_start() {
    string? declared = new ConfigurationBuilder().AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false).Build()[TABLE_NAME];

    declared.ShouldBe("firstseentimes", "the table name appsettings.json declares");
    await Should.NotThrowAsync(() => Starts(declared));
  }

  /// <summary>
  /// Starts and stops a host holding the store's registration, over <c>appsettings.json</c> with the table name
  /// <paramref name="tableName"/>; <see langword="null"/> leaves the name out of the configuration altogether.
  /// </summary>
  private static async Task Starts(string? tableName) {
    HostApplicationBuilder builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());
    _ = builder.Configuration.AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false);
    builder.Configuration[TABLE_NAME] = tableName;
    _ = builder.AddFirstSeenStore();

    using IHost app = builder.Build();
    await app.StartAsync();
    await app.StopAsync();
  }
}