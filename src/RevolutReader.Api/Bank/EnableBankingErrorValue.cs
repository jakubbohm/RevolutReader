using System.Text.Json;

namespace RevolutReader.Api.Bank;

/// <summary>
/// An error answer's <c>error</c> value (c006 design.md D3, D7), as the client and the retry rule both read it (c008
/// design.md D5): a code (<see cref="Code"/>, a value of the code shape, quoted as received), no value, or a value of
/// another shape (<see cref="IsUnrecognised"/>), which counts as no code and is never quoted. Moved from
/// <see cref="EnableBankingClient"/>'s private reading, unchanged in meaning.
/// </summary>
public readonly record struct EnableBankingErrorValue(string? Code, bool IsUnrecognised) {
  /// <summary>No value, in the log line.</summary>
  private const string NONE = "none";

  /// <summary>A value that does not have the shape of a code, in the log line: never quoted (c006 design.md D7).</summary>
  private const string UNRECOGNISED = "unrecognised";

  /// <summary>The API reference's names: snake_case, as the client reads every answer.</summary>
  private static readonly JsonSerializerOptions _json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

  /// <summary>The answer carried no error value.</summary>
  public static EnableBankingErrorValue None => default;

  /// <summary>As the log line says it: the code as received, <c>none</c> or <c>unrecognised</c>.</summary>
  public string Logged => Code ?? (IsUnrecognised ? UNRECOGNISED : NONE);

  /// <summary>
  /// Reads the error answer's body. No value: a body that is not JSON of the error answer's shape (none at all, a JSON
  /// <c>null</c>, a gateway's HTML page, plain text, an array), or a missing, <c>null</c> or blank <c>error</c>. A text of
  /// the code shape is a code; any other value, a text or not, is of another shape. What the body holds never makes it
  /// throw. The body is read into the content's buffer, so it can be read again: the retry rule reads an answer before the
  /// client reads it (c008 design.md D5).
  /// </summary>
  public static async Task<EnableBankingErrorValue> Read(HttpResponseMessage response, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(response);

    // Buffers the body (unlike reading it as a stream), so a later read of the same answer still finds it.
    byte[] body = await response.Content.ReadAsByteArrayAsync(cancellationToken);
    JsonElement error;

    try {
      error = JsonSerializer.Deserialize<EbError>(body, _json)?.Error ?? default;
    }
    catch (JsonException) {
      return None;
    }

    return error.ValueKind switch {
      JsonValueKind.Undefined or JsonValueKind.Null => None,
      JsonValueKind.String => Of(error.GetString()),
      _ => OfAnotherShape,
    };
  }

  /// <summary>A value that is not of the code shape.</summary>
  private static EnableBankingErrorValue OfAnotherShape => new(Code: null, IsUnrecognised: true);

  /// <summary>A blank text is no value, a text of the code shape a code, any other text a value of another shape.</summary>
  private static EnableBankingErrorValue Of(string? text) =>
    string.IsNullOrWhiteSpace(text) ? None
      : EnableBankingErrorCode.HasCodeShape(text) ? new(Code: text, IsUnrecognised: false)
      : OfAnotherShape;
}