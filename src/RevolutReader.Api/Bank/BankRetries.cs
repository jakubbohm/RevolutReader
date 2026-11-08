using System.Net.Http.Headers;
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
  /// <paramref name="time"/> (D4, D5, D8). Every number is set even where it equals the library's default, so the options
  /// say what production runs with (D7); no longest wait, as the request timeout bounds the waits (D1, D4).
  /// </summary>
  public static HttpRetryStrategyOptions Options(TimeSpan firstWait, TimeProvider time) {
    ArgumentNullException.ThrowIfNull(time);

    return new HttpRetryStrategyOptions {
      MaxRetryAttempts = MAX_RETRIES,
      Delay = firstWait,
      BackoffType = DelayBackoffType.Exponential,
      UseJitter = true,
      ShouldRetryAfterHeader = true,
      ShouldHandle = args => ShouldRetry(args.Context.GetRequestMessage(), args.Outcome, time.GetUtcNow(), args.Context.CancellationToken),
    };
  }

  /// <summary>
  /// D5: true only when <paramref name="request"/> carries <see cref="PresentUser"/> = true and the attempt failed in a way
  /// that reads as bank unavailable: an HttpRequestException, or an error answer whose error value
  /// (<see cref="EnableBankingErrorValue"/>) BankErrorClassification puts as Unavailable. False for a success, rate limited,
  /// access expired, an unexpected answer and any cancellation. D8: false too when the answer's Retry-After wait, counted
  /// from <paramref name="now"/>, would end after the request's <see cref="Deadline"/>, or when a Retry-After comes on a
  /// request without a deadline. Never throws for what an answer holds.
  /// </summary>
  public static async ValueTask<bool> ShouldRetry(HttpRequestMessage? request, Outcome<HttpResponseMessage> outcome, DateTimeOffset now, CancellationToken cancellationToken) {
    if (request is null || !request.Options.TryGetValue(PresentUser, out bool presentUser) || !presentUser)
      return false;

    // A network failure, also a body that breaks while it comes in; a cancellation, ours or the caller's, never (D1).
    if (outcome.Exception is { } exception)
      return exception is HttpRequestException;

    if (outcome.Result is not { IsSuccessStatusCode: false } answer)
      return false;

    EnableBankingErrorValue error = await EnableBankingErrorValue.Read(answer, cancellationToken);

    return BankErrorClassification.Classify(answer.StatusCode, error.Code) == BankErrorKind.Unavailable
      && RetryAfterEndsInTime(request, answer.Headers.RetryAfter, now);
  }

  /// <summary>
  /// D8: true without a Retry-After; with one, only when its wait (seconds, or until a date), counted from
  /// <paramref name="now"/>, ends strictly before the request's <see cref="Deadline"/>. A retry sent as the deadline comes
  /// could never be answered, so a wait that ends exactly then is a wait for nothing. A date already past is no wait.
  /// </summary>
  private static bool RetryAfterEndsInTime(HttpRequestMessage request, RetryConditionHeaderValue? retryAfter, DateTimeOffset now) {
    if (retryAfter is null)
      return true;

    if (!request.Options.TryGetValue(Deadline, out DateTimeOffset deadline))
      return false;

    TimeSpan wait = retryAfter.Delta ?? (retryAfter.Date - now) ?? TimeSpan.Zero;

    return now + (wait > TimeSpan.Zero ? wait : TimeSpan.Zero) < deadline;
  }
}