namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A transaction's payment details as the bank gives them (spec bank-reads): lines of text, in order. Compared line by
/// line, so a scenario can state the expected details as a value.
/// </summary>
public sealed class Lines : IEquatable<Lines> {
  /// <summary>No payment details.</summary>
  public static Lines None { get; } = new();

  public IReadOnlyList<string> Items { get; }

  public Lines(params IEnumerable<string> items) {
    ArgumentNullException.ThrowIfNull(items);

    Items = [.. items];
  }

  #region Object overrides

  public bool Equals(Lines? other) => other is not null && Items.SequenceEqual(other.Items, StringComparer.Ordinal);

  public override bool Equals(object? obj) => Equals(obj as Lines);

  public override int GetHashCode() => Items.Count;

  public override string ToString() => $"[{string.Join(", ", Items.Select(static line => $"\"{line}\""))}]";

  #endregion
}