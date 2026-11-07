using System.Security.Cryptography;
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
/// setting checked at start adds a made-up value to <see cref="MadeUpSettings"/>.
/// </para>
/// </summary>
[Explicit]
[Category("OpenApiExport")]
public sealed class OpenApiExport {
  /// <summary>FastEndpoints.OpenApi's default document name (<c>DocumentOptions.DocumentName</c>).</summary>
  private const string DOCUMENT_NAME = "v1";

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

  /// <summary>Made up, never real: each secret the app checks at start. The key is generated per run.</summary>
  private static Dictionary<string, string?> MadeUpSettings() {
    using RSA key = RSA.Create(2048);

    return new() {
      ["EnableBanking:ApplicationId"] = Guid.NewGuid().ToString(),
      ["EnableBanking:PrivateKey"] = key.ExportPkcs8PrivateKeyPem(),
      ["EnableBanking:SessionId"] = Guid.NewGuid().ToString(),
      ["EnableBanking:AccountId"] = Guid.NewGuid().ToString(),
    };
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

  /// <summary>An app copy in environment <c>Production</c> on the made-up settings, added last so they win.</summary>
  private sealed class ExportFactory : WebApplicationFactory<Program> {
    protected override void ConfigureWebHost(IWebHostBuilder builder) {
      builder.UseEnvironment(Environments.Production);
      builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(MadeUpSettings()));
    }
  }
}