using System.Text.Json;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The key-protected anonymous endpoints are hidden: the owner's message endpoint (c011 design.md D10) and, since C9a, the
/// account check (c014 design.md D6). Each is kept out of the API description, so the committed
/// <c>src/RevolutReader.Api/openapi.json</c>, which CI's drift check keeps equal to what the code describes, names neither
/// address, as a path or anywhere else in the file. A sibling address the file does name shows that the check reads the
/// real description. A rule, not a scenario.
/// </summary>
public sealed class HiddenEndpointsTests {
  /// <summary>The hidden message endpoint (D10), and the part of its address no other address shares.</summary>
  private const string MESSAGES = "/api/push/messages";
  private const string MESSAGES_PART = "push/messages";

  /// <summary>An address the description does name (C8a's registration, D9): proof the file is the API's description.</summary>
  private const string SUBSCRIPTION = "/api/push/subscription";

  /// <summary>The hidden account check (c014 design.md D6), and the part of its address no other address shares.</summary>
  private const string CHECK = "/api/account/check";
  private const string CHECK_PART = "account/check";

  /// <summary>An address the description does name (C7a's balance, which the check answers as): proof the file is the API's description.</summary>
  private const string BALANCE = "/api/balance";

  [Test]
  public Task The_message_endpoint_is_not_in_the_API_description() =>
    ShouldNotDescribe(MESSAGES, MESSAGES_PART, SUBSCRIPTION);

  [Test]
  public Task The_check_endpoint_is_not_in_the_API_description() =>
    ShouldNotDescribe(CHECK, CHECK_PART, BALANCE);

  /// <summary>
  /// The description names <paramref name="described"/> among its paths, and <paramref name="hidden"/> nowhere: not as a
  /// path (with or without a trailing "/", in any case), and <paramref name="hiddenPart"/> nowhere in the file.
  /// </summary>
  private static async Task ShouldNotDescribe(string hidden, string hiddenPart, string described) {
    string description = await File.ReadAllTextAsync(DocumentPath());
    using JsonDocument document = JsonDocument.Parse(description);
    string[] paths = [.. document.RootElement.GetProperty("paths").EnumerateObject().Select(static path => path.Name)];

    paths.ShouldSatisfyAllConditions(
      () => paths.ShouldContain(described, $"the description names {described}"),
      () => paths.ShouldNotContain(path => string.Equals(path.TrimEnd('/'), hidden, StringComparison.OrdinalIgnoreCase), $"no path of {hidden}"),
      () => description.ShouldNotContain(hiddenPart, Case.Insensitive, $"{hidden} nowhere in the description"));
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