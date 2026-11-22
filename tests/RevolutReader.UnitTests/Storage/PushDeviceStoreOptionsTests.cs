using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using RevolutReader.UnitTests.Configuration;
using Shouldly;

namespace RevolutReader.UnitTests.Storage;

/// <summary>
/// The <c>PushDevices</c> section is checked on start (c011 design.md D11), as the <c>Transactions</c> section is: its table
/// name is required and must be one Table Storage accepts, 3 to 63 letters and digits starting with a letter (letters as
/// Table Storage counts them, A to Z only), so a wrong name stops the app at start instead of failing the first request. A
/// failure of the setting's own rules is the standard data-annotation failure, naming the settings class and the setting,
/// never its value (the owner's decision on #68, 2026-11-22). Each test registers the store as the app does
/// (<see cref="StorageRegistration.AddPushDeviceStore"/>; reading its settings needs no tables client, which the
/// transaction store's registration adds) and reads the settings as the app's services give them, which runs the checks
/// registered for them.
/// </summary>
public sealed class PushDeviceStoreOptionsTests {
  /// <summary>The setting, as the configuration names it, written out, so a renamed setting fails here.</summary>
  private const string TABLE_NAME = "PushDevices:TableName";

  /// <summary>The default <c>appsettings.json</c> declares (D11).</summary>
  private const string DEFAULT_TABLE_NAME = "pushdevices";

  /// <param name="tableName">No name, or a name Table Storage refuses: too short or too long, not starting with a letter, or holding something other than letters and digits.</param>
  [Test]
  [Arguments("left out")]
  [Arguments("empty")]
  [Arguments("two characters")]
  [Arguments("64 characters")]
  [Arguments("starting with a digit")]
  [Arguments("with a hyphen")]
  [Arguments("with an underscore")]
  [Arguments("with a letter outside A to Z")]
  public void A_table_name_that_is_missing_or_not_3_to_63_letters_and_digits_starting_with_a_letter_fails_validation(string tableName) {
    string? name = tableName switch {
      "left out" => null,
      "empty" => string.Empty,
      "two characters" => "pd",
      "64 characters" => $"p{new string('x', 63)}",
      "starting with a digit" => "1pushdevices",
      "with a hyphen" => "push-devices",
      "with an underscore" => "push_devices",
      "with a letter outside A to Z" => "zařízení",
      _ => throw new ArgumentOutOfRangeException(nameof(tableName), tableName, "Not a known case."),
    };

    OptionsValidationException failure = Should.Throw<OptionsValidationException>(() => SettingsAfterRegistering(name), "the table name fails validation");

    failure.Failures.ShouldContain(message => message.Contains(nameof(PushDeviceStoreOptions.TableName), StringComparison.Ordinal), "a failure naming TableName");
  }

  [Test]
  public void The_default_table_name_passes_validation() =>
    SettingsAfterRegistering(DEFAULT_TABLE_NAME).TableName.ShouldBe(DEFAULT_TABLE_NAME);

  /// <summary>
  /// A failure of the setting's own rules is the standard data-annotation failure (the owner's decision on #68, 2026-11-22):
  /// it names the settings class and the setting (<c>'PushDeviceStoreOptions' members: 'TableName'</c>), then says what is
  /// wrong, and never holds the value.
  /// </summary>
  /// <param name="broken">How the table name breaks its own rules: left out, or not a name Table Storage accepts.</param>
  [Test]
  [Arguments("left out")]
  [Arguments("with a hyphen")]
  public void An_invalid_table_name_fails_validation_with_a_message_naming_its_settings_class_and_member_never_its_value(string broken) {
    (string? Name, string Says) invalid = broken switch {
      "left out" => (null, "required"),
      "with a hyphen" => ("push-devices", "3 to 63"),
      _ => throw new ArgumentOutOfRangeException(nameof(broken), broken, "Not a known case."),
    };

    OptionsValidationException failure = Should.Throw<OptionsValidationException>(() => SettingsAfterRegistering(invalid.Name), "the table name fails validation");

    failure.Failures.ShouldHaveDataAnnotationFailure<PushDeviceStoreOptions>(nameof(PushDeviceStoreOptions.TableName), invalid.Says);

    if (invalid.Name is { } name)
      failure.Failures.ShouldAllBe(message => !message.Contains(name, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>
  /// The <c>PushDevices</c> settings as the app's services give them after registering the store with this table name;
  /// <see langword="null"/> leaves the name out of the configuration.
  /// </summary>
  private static PushDeviceStoreOptions SettingsAfterRegistering(string? tableName) {
    HostApplicationBuilder builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());
    Dictionary<string, string?> settings = [];

    if (tableName is not null)
      settings[TABLE_NAME] = tableName;

    builder.Configuration.AddInMemoryCollection(settings);
    builder.AddPushDeviceStore();

    using IHost app = builder.Build();

    return app.Services.GetRequiredService<IOptions<PushDeviceStoreOptions>>().Value;
  }
}