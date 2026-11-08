namespace RevolutReader.Api.SignIn;

/// <summary>The parsed allowlist (D8).</summary>
public sealed class Allowlist {
  private Allowlist() {
  }

  /// <summary>The addresses on the list, trimmed, in the order written.</summary>
  public IReadOnlyList<string> Addresses { get; } = [];

  /// <summary>Trims; throws <see cref="FormatException"/> without the value.</summary>
  public static Allowlist Parse(string commaSeparated) => throw new NotImplementedException();
}