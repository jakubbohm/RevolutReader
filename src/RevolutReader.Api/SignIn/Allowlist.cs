namespace RevolutReader.Api.SignIn;

/// <summary>
/// The parsed allowlist (D8): the setting <see cref="SignInOptions.AllowedEmails"/> read as a list. Its addresses are never
/// written to a message or a log.
/// </summary>
public sealed class Allowlist {
  private const string NO_ADDRESS = "The allowlist holds no address: expected one or more email addresses, separated by commas.";
  private const string EMPTY_ENTRY = "The allowlist has an empty entry: nothing but spaces before, between or after its commas.";
  private const string NOT_AN_ADDRESS = "An allowlist entry is not an email address: expected text, one @, text.";

  private Allowlist(IReadOnlyList<string> addresses) => Addresses = addresses;

  /// <summary>The addresses on the list, trimmed, in the order written.</summary>
  public IReadOnlyList<string> Addresses { get; }

  /// <summary>
  /// Splits <paramref name="commaSeparated"/> on commas and trims each entry. It needs at least one entry, no empty entry,
  /// and each entry an email address: text, exactly one <c>@</c>, text. Otherwise it throws <see cref="FormatException"/>,
  /// whose message holds neither the value nor any part of it.
  /// </summary>
  public static Allowlist Parse(string commaSeparated) {
    ArgumentNullException.ThrowIfNull(commaSeparated);

    string[] entries = commaSeparated.Split(',', StringSplitOptions.TrimEntries);

    if (entries.All(static entry => entry.Length == 0))
      throw new FormatException(NO_ADDRESS);

    if (entries.Any(static entry => entry.Length == 0))
      throw new FormatException(EMPTY_ENTRY);

    if (!entries.All(IsEmailAddress))
      throw new FormatException(NOT_AN_ADDRESS);

    return new Allowlist(Array.AsReadOnly(entries));
  }

  /// <summary>Ignoring case; null or empty → false.</summary>
  public bool Allows(string? email) => throw new NotImplementedException();

  /// <summary>Text, exactly one <c>@</c>, text.</summary>
  private static bool IsEmailAddress(string entry) {
    int at = entry.IndexOf('@', StringComparison.Ordinal);

    return at > 0 && at == entry.LastIndexOf('@', StringComparison.Ordinal) && at < entry.Length - 1;
  }
}