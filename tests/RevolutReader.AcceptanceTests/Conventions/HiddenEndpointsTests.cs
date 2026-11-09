using System.Text.Json;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The owner's message endpoint is hidden (c011 design.md D10): it is kept out of the API description, so the committed
/// <c>src/RevolutReader.Api/openapi.json</c>, which CI's drift check keeps equal to what the code describes, names no
/// <c>/api/push/messages</c>, neither as a path nor anywhere else in the file. The file's other push addresses are there,
/// so the check reads the real description. A rule, not a scenario.
/// </summary>
public sealed class HiddenEndpointsTests {
  /// <summary>The hidden address (D10), and the part of it no other address shares.</summary>
  private const string MESSAGES = "/api/push/messages";
  private const string MESSAGES_PART = "push/messages";

  /// <summary>An address the description does name (C8a's registration, D9): proof the file is the API's description.</summary>
  private const string SUBSCRIPTION = "/api/push/subscription";

  [Test]
  public async Task The_message_endpoint_is_not_in_the_API_description() {
    string description = await File.ReadAllTextAsync(DocumentPath());
    using JsonDocument document = JsonDocument.Parse(description);
    string[] paths = [.. document.RootElement.GetProperty("paths").EnumerateObject().Select(static path => path.Name)];

    paths.ShouldSatisfyAllConditions(
      () => paths.ShouldContain(SUBSCRIPTION, "the description names the other push addresses"),
      () => paths.ShouldNotContain(path => string.Equals(path.TrimEnd('/'), MESSAGES, StringComparison.OrdinalIgnoreCase), "no path of the message endpoint"),
      () => description.ShouldNotContain(MESSAGES_PART, Case.Insensitive, "the message endpoint's address nowhere in the description"));
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
}