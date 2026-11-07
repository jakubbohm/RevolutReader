namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A request the bank received, as far as the scenarios care (spec bank-reads, THEN): the user headers it carried.
/// <see cref="Headers"/> is <see langword="null"/> when it carried no user header at all.
/// </summary>
public sealed record RequestAtBank(UserHeaders? Headers) {
  /// <summary>A request carrying no user header.</summary>
  public static RequestAtBank WithoutUserHeaders { get; } = new(Headers: null);

  /// <summary>A request carrying the user headers with this user's IP address and browser.</summary>
  public static RequestAtBank WithUserHeadersOf(UserAtDevice user) {
    ArgumentNullException.ThrowIfNull(user);

    return new(new UserHeaders(user.IpAddress, user.Browser));
  }
}

/// <summary>
/// The user headers on one request: the user's IP address and browser, each <see langword="null"/> when that header is
/// missing.
/// </summary>
public sealed record UserHeaders(string? IpAddress, string? Browser);