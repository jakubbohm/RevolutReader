using System.Globalization;
using FastEndpoints;
using Microsoft.Extensions.Primitives;

namespace RevolutReader.Api.Hosting;

/// <summary>
/// How the API reads a calendar date from a query, route, form, header or claim: exactly <c>yyyy-MM-dd</c> (c010 design.md
/// D10, as an older page's <c>before</c>), the same whatever the server's culture. FastEndpoints' own reading of a
/// <see cref="DateOnly"/> follows the server's culture, so on a Czech machine <c>20.11.2026</c> would be a date. A value
/// this does not read fails binding, which FastEndpoints answers with its 400 problem description, as any value it cannot
/// read. A JSON body's dates are read by System.Text.Json, which takes ISO 8601 dates only, and are not affected.
/// </summary>
public static class CalendarDateBinding {
  /// <summary>As the API writes and reads a calendar date.</summary>
  private const string FORMAT = "yyyy-MM-dd";

  /// <summary>One value, exactly <c>yyyy-MM-dd</c> and a day that exists; anything else, none or several values included, is not a date.</summary>
  public static ParseResult Parse(StringValues input) =>
    input.Count == 1 && DateOnly.TryParseExact(input[0], FORMAT, CultureInfo.InvariantCulture, DateTimeStyles.None, out DateOnly date)
      ? new ParseResult(true, date)
      : new ParseResult(false, null);
}