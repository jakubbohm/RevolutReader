using Microsoft.Extensions.Http.Resilience;
using Polly;

namespace RevolutReader.Api.Bank;

/// <summary>The bank client's retries (c008 design.md D1–D8): what is retried, how often and how long it waits.</summary>
public static class BankRetries {
  /// <summary>At most this many retries after the first attempt (D4, D7).</summary>
  public const int MAX_RETRIES = 3;

  /// <summary>Set on a request of a present user's read, the only kind ever retried; a request without it is never retried (D2).</summary>
  public static readonly HttpRequestOptionsKey<bool> PresentUser = new("RevolutReader.Bank.PresentUser");

  /// <summary>Set on every request: when its request timeout runs out (now + RequestTimeout). A Retry-After wait must end before it (D8).</summary>
  public static readonly HttpRequestOptionsKey<DateTimeOffset> Deadline = new("RevolutReader.Bank.Deadline");

  /// <summary>
  /// The retry strategy: MAX_RETRIES, exponential waits from <paramref name="firstWait"/> with jitter, Retry-After followed,
  /// ShouldHandle = <see cref="ShouldRetry"/> with the request taken from the resilience context and now from
  /// <paramref name="time"/> (D4, D5, D8).
  /// </summary>
  public static HttpRetryStrategyOptions Options(TimeSpan firstWait, TimeProvider time) => throw new NotImplementedException();

  /// <summary>
  /// D5: true only when <paramref name="request"/> carries <see cref="PresentUser"/> = true and the attempt failed in a way
  /// that reads as bank unavailable: an HttpRequestException, or an error answer whose error value
  /// (EnableBankingErrorValue) BankErrorClassification puts as Unavailable. False for a success, rate limited, access
  /// expired, an unexpected answer and any cancellation. D8: false too when the answer's Retry-After wait, counted from
  /// <paramref name="now"/>, would end after the request's <see cref="Deadline"/>, or when a Retry-After comes on a request
  /// without a deadline. Never throws for what an answer holds.
  /// </summary>
  public static ValueTask<bool> ShouldRetry(HttpRequestMessage? request, Outcome<HttpResponseMessage> outcome, DateTimeOffset now, CancellationToken cancellationToken) =>
    throw new NotImplementedException();
}