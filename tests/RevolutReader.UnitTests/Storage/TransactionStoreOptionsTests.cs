using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using Shouldly;

namespace RevolutReader.UnitTests.Storage;

/// <summary>
/// The <c>Transactions</c> section is checked on start (c010 design.md D11): its table name must be one Table Storage
/// accepts, 3 to 63 letters and digits starting with a letter (letters as Table Storage counts them, A to Z only), so
/// each acceptance test can use a table of its own and a wrong name stops the app at start instead of failing the first
/// request. A failure of the setting's own rules names it by its full name, as the operator sets it (#68). Each test
/// registers the store as the app does (<see cref="StorageRegistration.AddTransactionStore"/>, with a tables connection
/// set) and reads the settings as the app's services give them, which runs the checks registered for them. The connection
/// is Azurite's well-known shorthand for its local account, no secret; nothing here reaches it.
/// </summary>
public sealed class TransactionStoreOptionsTests {
  private const string TABLES_CONNECTION = "ConnectionStrings:tables";
  private const string TABLE_NAME = "Transactions:TableName";
  private const string LOCAL_EMULATOR = "UseDevelopmentStorage=true";

  /// <summary>The default <c>appsettings.json</c> declares (D11).</summary>
  private const string DEFAULT_TABLE_NAME = "transactions";

  /// <param name="tableName">A name Table Storage refuses: too short or too long, not starting with a letter, or holding something other than letters and digits.</param>
  [Test]
  [Arguments("empty")]
  [Arguments("two characters")]
  [Arguments("64 characters")]
  [Arguments("starting with a digit")]
  [Arguments("with a hyphen")]
  [Arguments("with an underscore")]
  [Arguments("with a letter outside A to Z")]
  public void A_table_name_that_is_not_3_to_63_letters_and_digits_starting_with_a_letter_fails_validation(string tableName) {
    string name = tableName switch {
      "empty" => string.Empty,
      "two characters" => "tx",
      "64 characters" => $"t{new string('x', 63)}",
      "starting with a digit" => "1transactions",
      "with a hyphen" => "trans-actions",
      "with an underscore" => "trans_actions",
      "with a letter outside A to Z" => "transakceČ",
      _ => throw new ArgumentOutOfRangeException(nameof(tableName), tableName, "Not a known case."),
    };

    OptionsValidationException failure = Should.Throw<OptionsValidationException>(() => SettingsAfterRegistering(name), "the table name fails validation");

    failure.Failures.ShouldContain(message => message.Contains(nameof(TransactionStoreOptions.TableName), StringComparison.Ordinal), "a failure naming TableName");
  }

  [Test]
  public void The_default_table_name_passes_validation() =>
    SettingsAfterRegistering(DEFAULT_TABLE_NAME).TableName.ShouldBe(DEFAULT_TABLE_NAME);

  /// <summary>
  /// A failure of the setting's own rules (#68) names it by its full name, as the operator sets it
  /// (<c>Transactions:TableName</c>, or <c>Transactions__TableName</c> in the environment): the message starts with the
  /// section, the setting and ": ", then says what is wrong, and never holds the value.
  /// </summary>
  /// <param name="broken">How the table name breaks its own rules: left out, or not a name Table Storage accepts.</param>
  [Test]
  [Arguments("left out")]
  [Arguments("with a hyphen")]
  public void An_invalid_table_name_fails_validation_with_a_message_starting_with_its_full_name_never_its_value(string broken) {
    (string? Name, string Says) invalid = broken switch {
      "left out" => (null, "required"),
      "with a hyphen" => ("trans-actions", "3 to 63"),
      _ => throw new ArgumentOutOfRangeException(nameof(broken), broken, "Not a known case."),
    };

    OptionsValidationException failure = Should.Throw<OptionsValidationException>(() => SettingsAfterRegistering(invalid.Name), "the table name fails validation");

    failure.Failures.ShouldContain(
      message => message.StartsWith($"{TABLE_NAME}: ", StringComparison.Ordinal) && message.Contains(invalid.Says, StringComparison.OrdinalIgnoreCase),
      $"a failure starting with \"{TABLE_NAME}: \" that says the name is {invalid.Says}; the failures were: {string.Join(" | ", failure.Failures)}");

    if (invalid.Name is { } name)
      failure.Failures.ShouldAllBe(message => !message.Contains(name, StringComparison.Ordinal), "no failure message may contain the setting's value");
  }

  /// <summary>
  /// The <c>Transactions</c> settings as the app's services give them after registering the store with this table name;
  /// <see langword="null"/> leaves the name out of the configuration.
  /// </summary>
  private static TransactionStoreOptions SettingsAfterRegistering(string? tableName) {
    HostApplicationBuilder builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());
    Dictionary<string, string?> settings = new() { [TABLES_CONNECTION] = LOCAL_EMULATOR };

    if (tableName is not null)
      settings[TABLE_NAME] = tableName;

    builder.Configuration.AddInMemoryCollection(settings);
    builder.AddTransactionStore();

    using IHost app = builder.Build();

    return app.Services.GetRequiredService<IOptions<TransactionStoreOptions>>().Value;
  }
}