namespace RevolutReader.Api.Rate;

/// <summary>The CNB port (c017 design.md D6): the euro's rate in the CNB's latest daily rates.</summary>
public interface ICnbRates {
  /// <summary>The euro's rate in the CNB's latest daily rates, or why not. A caller's cancellation throws.</summary>
  Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken);
}