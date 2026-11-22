namespace RevolutReader.Api.Rate;

/// <summary>
/// The kept rate's port (c017 design.md D2): one rate, the last one kept. Storage failures and a row it cannot read are
/// exceptions, as the other stores' (§ Error model).
/// </summary>
public interface IKorunaRateStore {
  /// <summary>The rate as last saved; null when none is.</summary>
  Task<KorunaRate?> Read(CancellationToken cancellationToken);

  /// <summary>Replaces the kept rate.</summary>
  Task Save(KorunaRate rate, CancellationToken cancellationToken);
}