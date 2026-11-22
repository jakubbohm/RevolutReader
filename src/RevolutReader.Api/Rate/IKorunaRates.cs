namespace RevolutReader.Api.Rate;

/// <summary>The rate an answer carries (c017 design.md D2–D5).</summary>
public interface IKorunaRates {
  /// <summary>
  /// The kept rate; when one is due (<see cref="RateAsking.IsDue"/>), first the CNB's answer, shared with every caller
  /// asking meanwhile and kept when it is for a later day; the kept one when the ask fails; <see cref="KorunaRate.AppsOwn"/>
  /// when nothing is kept. Never throws for the CNB or the store; only <paramref name="cancellationToken"/> ends this
  /// caller's wait.
  /// </summary>
  Task<KorunaRate> Current(CancellationToken cancellationToken);
}