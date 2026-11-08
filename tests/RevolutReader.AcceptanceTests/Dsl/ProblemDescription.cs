namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A problem description the API answered with (spec api-errors), identified by the case its title names, and for the
/// app's own cases also by its <c>type</c>. The driver returns one only when the answer's status, content type and body
/// agree (<see cref="Drivers.ApiDriver"/>, <see cref="Drivers.TransactionsDriver"/>).
/// </summary>
/// <param name="Title">The case's title.</param>
/// <param name="Type">
/// The app's own <c>type</c> (<c>/problems/…</c>), which a client compares exactly (spec account-balance, c009 design.md
/// D1); <see langword="null"/> for a plain status's RFC 9110 <c>type</c>, so the values from before it keep comparing
/// equal.
/// </param>
public sealed record ProblemDescription(string Title, string? Type = null) {
  /// <summary>The API does not serve the address: title <c>Not Found</c>, status 404.</summary>
  public static ProblemDescription NotFound { get; } = new("Not Found");

  /// <summary>The API cannot read the request (a value it cannot bind, or a balance request naming no browser): title <c>Bad Request</c>, status 400.</summary>
  public static ProblemDescription BadRequest { get; } = new("Bad Request");

  /// <summary>Nobody is signed in: title <c>Unauthorized</c>, status 401.</summary>
  public static ProblemDescription Unauthorized { get; } = new("Unauthorized");

  /// <summary>
  /// The router's own rejection of a method a page address does not take (a write to a page address): title
  /// <c>Method Not Allowed</c>, status 405. Not a case of the API's table: page addresses are not the API
  /// (docs/conventions/README.md § Backend code, secure by default).
  /// </summary>
  public static ProblemDescription MethodNotAllowed { get; } = new("Method Not Allowed");

  /// <summary>The bank's access to the account has expired: title <c>Bank access expired</c>, type <c>/problems/bank-access-expired</c>, status 503 (C13).</summary>
  public static ProblemDescription BankAccessExpired { get; } = new("Bank access expired", "/problems/bank-access-expired");

  /// <summary>The bank's request limit is reached: title <c>Bank rate limit reached</c>, type <c>/problems/bank-rate-limited</c>, status 429 (C13).</summary>
  public static ProblemDescription BankRateLimited { get; } = new("Bank rate limit reached", "/problems/bank-rate-limited");

  /// <summary>The bank does not answer: title <c>Bank unavailable</c>, type <c>/problems/bank-unavailable</c>, status 503 (C13).</summary>
  public static ProblemDescription BankUnavailable { get; } = new("Bank unavailable", "/problems/bank-unavailable");

  /// <summary>The API failed in a way it does not expect: title <c>Internal Server Error</c>, RFC 9110's type, status 500 (spec api-errors).</summary>
  public static ProblemDescription InternalServerError { get; } = new("Internal Server Error");
}