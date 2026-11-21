namespace RevolutReader.Api.Rate;

/// <summary>
/// The rate an answer carries (c017 design.md D2–D5, D9): a singleton holding the kept rate and the ask in flight. A
/// compile-only stub until tasks.md 6.1.
/// </summary>
public sealed class KorunaRates : IKorunaRates {
  public KorunaRates(ICnbRates cnb, IKorunaRateStore store, TimeProvider time, ILogger<KorunaRates> logger) =>
    throw new NotImplementedException("KorunaRates is implemented in tasks.md 6.1.");

  public Task<KorunaRate> Current(CancellationToken cancellationToken) => throw new NotImplementedException("KorunaRates.Current is implemented in tasks.md 6.1.");
}