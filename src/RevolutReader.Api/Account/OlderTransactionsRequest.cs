using FastEndpoints;

namespace RevolutReader.Api.Account;

/// <summary>What an older page is asked for (c010 design.md D10): the query <c>before=yyyy-MM-dd</c>. Its API description is set in <see cref="OlderTransactionsEndpoint"/>.</summary>
public sealed record OlderTransactionsRequest {
  /// <summary>The day before which the page's transactions are dated: the <c>olderBefore</c> of the page before it. Required, a calendar date.</summary>
  [QueryParam]
  public required DateOnly Before { get; init; }
}