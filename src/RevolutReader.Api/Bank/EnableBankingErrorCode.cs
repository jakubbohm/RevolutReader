using System.Buffers;

namespace RevolutReader.Api.Bank;

/// <summary>The shape of an Enable Banking error code (c006 design.md D7).</summary>
public static class EnableBankingErrorCode {
  /// <summary>The longest value that still has the code shape; Enable Banking's longest code has 32 characters.</summary>
  private const int MOST_CHARACTERS = 64;

  /// <summary>The characters a code continues with: ASCII capitals and the underscore.</summary>
  private static readonly SearchValues<char> _codeCharacters = SearchValues.Create("ABCDEFGHIJKLMNOPQRSTUVWXYZ_");

  /// <summary>
  /// A capital letter, then capital letters and underscores, 64 characters at most (^[A-Z][A-Z_]{0,63}$, ordinal).
  /// No digits: an account or session id is a GUID, and written in capitals without its dashes it would pass a shape
  /// that allowed them (D7).
  /// </summary>
  public static bool HasCodeShape(string? value) =>
    value is { Length: > 0 and <= MOST_CHARACTERS }
      && char.IsAsciiLetterUpper(value[0])
      && !value.AsSpan(1).ContainsAnyExcept(_codeCharacters);
}