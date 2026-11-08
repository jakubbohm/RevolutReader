using Azure.Data.Tables;
using DotNet.Testcontainers.Builders;
using Testcontainers.Azurite;
using TUnit.Core.Interfaces;

namespace RevolutReader.IntegrationTests.Storage;

/// <summary>
/// Azurite, the storage emulator the Table adapter is tested against (c010 design.md D12, § Ports and contracts): one
/// container per test session, a TUnit shared data source, started through Testcontainers before the first test that
/// needs it and removed when the session ends. Its image is pinned (<see cref="IMAGE"/>), as the acceptance harness's.
/// Each test uses a table of its own (<see cref="UniqueTableName"/>), so tests stay apart without cleanup. Named for what
/// it gives: a type named <c>Azurite</c> would clash with the <c>Testcontainers.Azurite</c> namespace (CA1724).
/// <para>
/// Without Docker it stops with a message saying so (testing.md: Docker-dependent tests stop with a message, never skip).
/// </para>
/// </summary>
public sealed class AzuriteTables : IAsyncInitializer, IAsyncDisposable {
  /// <summary>The emulator's image, pinned (c010 design.md D12; the version the bootstrap's probe ran, 2026-11-08).</summary>
  public const string IMAGE = "mcr.microsoft.com/azure-storage/azurite:3.37.0";

  private AzuriteContainer? _container;
  private TableServiceClient? _tables;

  /// <summary>The table service of the running container, reached with its connection string (Azurite's well-known development key, no secret).</summary>
  public TableServiceClient Tables => _tables ?? throw new InvalidOperationException("Azurite has not been started.");

  /// <summary>A valid table name (3 to 63 letters and digits, starting with a letter, D11) no other test uses: <c>t</c> and a new GUID's 32 hex digits.</summary>
  public static string UniqueTableName() => $"t{Guid.NewGuid():N}";

  /// <summary>Starts the container; without Docker, stops with a message saying so.</summary>
  public async Task InitializeAsync() {
    try {
      _container = new AzuriteBuilder(IMAGE).Build();
      await _container.StartAsync();
    }
    catch (DockerUnavailableException exception) {
      throw new InvalidOperationException(
        "The Table adapter's contract tests need Docker running: they run against Azurite, in a container (Storage/AzuriteTables). Start Docker and run the tests again.",
        exception);
    }

    _tables = new TableServiceClient(_container.GetConnectionString());
  }

  #region IAsyncDisposable

  public async ValueTask DisposeAsync() {
    if (_container is not null)
      await _container.DisposeAsync();
  }

  #endregion
}