namespace RevolutReader.Api.Bank;

/// <summary>
/// Inside the retry handler: loads each answer's body into memory within its attempt (c008 design.md D6). Without it,
/// <c>HttpClient</c> reads the body only after the retry handler has returned, so a connection that breaks while the body
/// comes in would never be retried. Here that break fails the attempt itself, as the network failure
/// (<see cref="HttpRequestException"/>) the retry rule retries for a present user (<see cref="BankRetries.ShouldRetry"/>),
/// and the rule and the client read an answer that is already whole. Bodies are small (a page of about 50 transactions).
/// </summary>
public sealed class WholeAnswerHandler : DelegatingHandler {
  /// <summary>The answer, its body in memory; when the body cannot be read whole, the answer is disposed and the failure passes on.</summary>
  protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
    HttpResponseMessage response = await base.SendAsync(request, cancellationToken);

    try {
      await response.Content.LoadIntoBufferAsync(cancellationToken);
    }
    catch {
      response.Dispose();

      throw;
    }

    return response;
  }
}