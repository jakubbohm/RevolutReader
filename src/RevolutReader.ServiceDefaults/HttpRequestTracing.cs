namespace RevolutReader.ServiceDefaults;

/// <summary>
/// Keeps an outgoing request out of the exported HTTP-client traces (c004 design.md D5): the instrumentation records a
/// request's URL, and a client whose paths carry an identifier (the bank's account id) marks its requests with
/// <see cref="Exclude"/>, so nothing exports the URL and nothing has to be masked.
/// </summary>
public static class HttpRequestTracing {
  /// <summary>A request carrying this option, set to <see langword="true"/>, is left out of the exported HTTP-client traces.</summary>
  public static readonly HttpRequestOptionsKey<bool> Exclude = new("RevolutReader.ExcludeFromTracing");

  /// <summary>Whether <paramref name="request"/> is left out (<see cref="Exclude"/>).</summary>
  internal static bool IsExcluded(HttpRequestMessage request) => request.Options.TryGetValue(Exclude, out bool excluded) && excluded;
}