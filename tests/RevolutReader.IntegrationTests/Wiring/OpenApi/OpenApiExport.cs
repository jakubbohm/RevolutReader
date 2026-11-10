using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.OpenApi;

/// <summary>
/// Writes the API's OpenAPI document to <c>src/RevolutReader.Api/openapi.json</c>, the file the TypeScript client is
/// generated from (c007 design.md D9). The fallback of design.md § Bootstrap, item 2: an export at build time starts the
/// app with the placeholder secrets of <c>appsettings.json</c>, which its start-up checks refuse. So this starts an app
/// copy in environment <c>Production</c> with made-up settings for every secret it checks, reads the document the app
/// would describe, and writes it. The app itself never serves it.
/// <para>
/// Explicit: <c>dotnet test</c> never runs it. The regenerate script and the drift step in CI do. A change that adds a
/// setting checked at start adds a made-up value to the shared <see cref="MadeUpSettings"/>.
/// </para>
/// </summary>
[Explicit]
[Category("OpenApiExport")]
public sealed class OpenApiExport {
  /// <summary>FastEndpoints.OpenApi's default document name (<c>DocumentOptions.DocumentName</c>).</summary>
  private const string DOCUMENT_NAME = "v1";

  /// <summary>The export's allowlist, made up: the app checks it at start, and the export signs no one in.</summary>
  private const string ALLOWED_EMAILS = "export@example.com";

  [Test]
  public async Task Writes_the_api_description() {
    await using ExportFactory factory = new();
    IOpenApiDocumentProvider provider = factory.Services.GetRequiredKeyedService<IOpenApiDocumentProvider>(DOCUMENT_NAME);
    OpenApiSpecVersion version = factory.Services.GetRequiredService<IOptionsMonitor<OpenApiOptions>>().Get(DOCUMENT_NAME).OpenApiVersion;

    OpenApiDocument document = await provider.GetOpenApiDocumentAsync(CancellationToken.None);
    string json = await document.SerializeAsJsonAsync(version, CancellationToken.None);

    document.Paths.ShouldContainKey("/health", "the document describes the API's endpoints");
    // One line ending everywhere, so a document written on Windows and one written in CI compare equal.
    await File.WriteAllTextAsync(DocumentPath(), json.ReplaceLineEndings("\n") + "\n");
  }

  /// <summary><c>src/RevolutReader.Api/openapi.json</c>, found from the test's output folder up to the repository root.</summary>
  private static string DocumentPath() {
    DirectoryInfo? folder = new(AppContext.BaseDirectory);

    while (folder is not null && !File.Exists(Path.Combine(folder.FullName, "RevolutReader.slnx")))
      folder = folder.Parent;

    return folder is null
      ? throw new InvalidOperationException($"No RevolutReader.slnx above {AppContext.BaseDirectory}.")
      : Path.Combine(folder.FullName, "src", "RevolutReader.Api", "openapi.json");
  }

  /// <summary>
  /// An app copy in environment <c>Production</c> on the made-up settings, added last so they win. The transaction store's
  /// connection is checked while Program.cs registers the store (c010 design.md D11), before a source added with
  /// <c>ConfigureAppConfiguration</c> arrives, so it goes in as a host setting, which the factory hands to the app's builder
  /// before Program.cs runs: Azurite's shorthand for its local account, never reached, as the export reads no table.
  /// </summary>
  private sealed class ExportFactory : WebApplicationFactory<Program> {
    private const string TABLES_CONNECTION = "ConnectionStrings:tables";
    private const string MADE_UP_TABLES_CONNECTION = "UseDevelopmentStorage=true";

    protected override void ConfigureWebHost(IWebHostBuilder builder) {
      builder.UseEnvironment(Environments.Production);
      builder.UseSetting(TABLES_CONNECTION, MADE_UP_TABLES_CONNECTION);
      builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(MadeUpSettings.For(ALLOWED_EMAILS)));
    }
  }
}