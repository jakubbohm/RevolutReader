using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using RevolutReader.Api.Storage;
using Shouldly;

namespace RevolutReader.UnitTests.Storage;

/// <summary>
/// The transaction store's connection is checked while services are registered (c010 design.md D11): the Aspire client
/// checks <c>ConnectionStrings:tables</c> only when first resolved, so without this check a missing setting would answer
/// the first transactions request with a 500 instead of stopping the app at start. The message names the setting, never
/// a value, as <c>AddDataProtectionKeys</c> does. An empty setting, as <c>appsettings.json</c> declares it, or one of
/// spaces only, counts as not set. The setting's real name is written out, so a renamed setting fails here.
/// </summary>
public sealed class StorageRegistrationTests {
  private const string TABLES_CONNECTION = "ConnectionStrings:tables";
  private const string TABLE_NAME = "Transactions:TableName";

  /// <summary>A valid table name of the app copy's own (made up, distinctive), so a message quoting configured values would show it.</summary>
  private const string MADE_UP_TABLE_NAME = "madeUpTable7c41";

  /// <param name="connectionIs">How the setting is not set: left out, empty as <c>appsettings.json</c> declares it, or spaces only.</param>
  [Test]
  [Arguments("missing")]
  [Arguments("empty, as appsettings.json declares it")]
  [Arguments("spaces only")]
  public void A_missing_tables_connection_is_refused_at_registration_and_the_message_names_the_setting_only(string connectionIs) {
    string? connection = connectionIs switch {
      "missing" => null,
      "empty, as appsettings.json declares it" => string.Empty,
      "spaces only" => "   ",
      _ => throw new ArgumentOutOfRangeException(nameof(connectionIs), connectionIs, "Not a known case."),
    };
    HostApplicationBuilder builder = Builder(connection);

    string message = Should.Throw<Exception>(() => builder.AddTransactionStore(), "refused at registration").Message;

    message.ShouldSatisfyAllConditions(
      () => message.ShouldContain(TABLES_CONNECTION, Case.Sensitive),
      () => message.ShouldNotContain(MADE_UP_TABLE_NAME, Case.Insensitive));
  }

  /// <summary>An application builder with no configuration but these settings under their real names: <see langword="null"/> leaves the connection out.</summary>
  private static HostApplicationBuilder Builder(string? tablesConnection) {
    HostApplicationBuilder builder = Host.CreateEmptyApplicationBuilder(new HostApplicationBuilderSettings());
    Dictionary<string, string?> settings = new() { [TABLE_NAME] = MADE_UP_TABLE_NAME };

    if (tablesConnection is not null)
      settings[TABLES_CONNECTION] = tablesConnection;

    builder.Configuration.AddInMemoryCollection(settings);

    return builder;
  }
}