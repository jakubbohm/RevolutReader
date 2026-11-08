using DotNet.Testcontainers.Builders;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Testcontainers.Azurite;
using TUnit.Core.Interfaces;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Azurite, the storage emulator every test app copy keeps its transactions in (c010 design.md D12: fake only what we do
/// not own, so the real Table adapter runs): one container per test session, a TUnit shared data source
/// (<see cref="AcceptanceTest.Azurite"/>), started through Testcontainers before the first test that needs it and removed
/// when the session ends. Its image is pinned (<see cref="IMAGE"/>). Named for what it gives the app: a type named
/// <c>Azurite</c> would clash with the <c>Testcontainers.Azurite</c> namespace (CA1724).
/// <para>
/// Every app copy gets its settings (<see cref="Configure"/>), so the app starts whether or not the test reads the
/// transactions: <c>ConnectionStrings:tables</c> is the container's connection string, and
/// <c>Transactions:TableName</c> a table of the app copy's own, so tests stay apart without cleanup.
/// </para>
/// <para>
/// Without Docker it stops with a message saying so (testing.md: Docker-dependent tests stop with a message, never skip).
/// </para>
/// </summary>
public sealed class AzuriteStorage : IAsyncInitializer, IAsyncDisposable {
  /// <summary>The emulator's image, pinned (c010 design.md D12; the version the bootstrap's probe ran, 2026-11-08).</summary>
  public const string IMAGE = "mcr.microsoft.com/azure-storage/azurite:3.37.0";

  /// <summary>The settings the app copy reads its table from (c010 design.md D11).</summary>
  private const string CONNECTION_STRING = "ConnectionStrings:tables";
  private const string TABLE_NAME = "Transactions:TableName";

  private AzuriteContainer? _container;

  /// <summary>The running container's connection string: the account key is Azurite's well-known development key, no secret.</summary>
  private string ConnectionString => (_container ?? throw new InvalidOperationException("Azurite has not been started.")).GetConnectionString();

  /// <summary>Starts the container; without Docker, stops with a message saying so.</summary>
  public async Task InitializeAsync() {
    try {
      _container = new AzuriteBuilder(IMAGE).Build();
      await _container.StartAsync();
    }
    catch (DockerUnavailableException exception) {
      throw new InvalidOperationException(
        "The acceptance tests need Docker running: every test app copy keeps its transactions in Azurite, which runs in a container (Drivers/AzuriteStorage). Start Docker and run the tests again.",
        exception);
    }
  }

  /// <summary>
  /// Writes the store's settings into the app copy, as the last configuration source, so they win over
  /// <c>appsettings.json</c>: this container's connection string, and a table name no other app copy uses.
  /// </summary>
  public void Configure(IWebHostBuilder builder) {
    ArgumentNullException.ThrowIfNull(builder);

    Dictionary<string, string?> settings = new() {
      [CONNECTION_STRING] = ConnectionString,
      [TABLE_NAME] = UniqueTableName(),
    };

    builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
  }

  /// <summary>A valid table name (3 to 63 letters and digits, starting with a letter, D11) no other app copy uses: <c>t</c> and a new GUID's 32 hex digits.</summary>
  private static string UniqueTableName() => $"t{Guid.NewGuid():N}";

  #region IAsyncDisposable

  public async ValueTask DisposeAsync() {
    if (_container is not null)
      await _container.DisposeAsync();
  }

  #endregion
}