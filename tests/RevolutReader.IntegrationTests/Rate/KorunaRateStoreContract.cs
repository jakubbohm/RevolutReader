using System.Globalization;
using RevolutReader.Api.Rate;
using Shouldly;

namespace RevolutReader.IntegrationTests.Rate;

/// <summary>
/// The contract of the kept koruna rate's store (c017 design.md § Ports and contracts, D2), written only against
/// <see cref="IKorunaRateStore"/>, and run against both the in-memory fake the unit tests use
/// (<see cref="InMemoryKorunaRateStoreContract"/>) and the Table adapter on Azurite
/// (<see cref="TableKorunaRateStoreContract"/>), so the fake stays honest:
/// <list type="bullet">
/// <item><c>Read</c>: <see langword="null"/> when nothing was ever saved; otherwise the rate as last saved, exactly: the
/// decimal with its scale (a trailing zero as the CNB writes one, and more digits than a <see cref="double"/> holds) and the
/// date to the day.</item>
/// <item><c>Save</c>: replaces the kept rate whole, whatever its day: the rule that only a later day's rate replaces the kept
/// one is the service's (D2), not the store's.</item>
/// </list>
/// Each test starts from a new, empty store of its own (<see cref="NewStore"/>: for the adapter, a table no other test
/// uses). The rates are the CNB's form of a rate, made up but for the spec's.
/// </summary>
public abstract class KorunaRateStoreContract {
  [Test]
  public async Task Nothing_saved_reads_as_nothing() {
    IKorunaRateStore store = NewStore();

    (await store.Read(CancellationToken.None)).ShouldBeNull();
  }

  /// <param name="czkPerEur">
  /// The rate as invariant text: <c>24.470</c>, as the CNB writes the euro's rate (its trailing zero is the decimal's scale,
  /// which a store that normalized the decimal or went through a <see cref="double"/> would drop); and a rate with more
  /// digits than a <see cref="double"/> holds.
  /// </param>
  [Test]
  [Arguments("24.470")]
  [Arguments("24.1234567890123456789")]
  public async Task A_saved_rate_reads_back_exactly_the_decimal_with_its_scale_the_date_to_the_day(string czkPerEur) {
    IKorunaRateStore store = NewStore();
    await store.Save(new KorunaRate(decimal.Parse(czkPerEur, CultureInfo.InvariantCulture), new DateOnly(2026, 11, 20)), CancellationToken.None);

    KorunaRate read = (await store.Read(CancellationToken.None)).ShouldNotBeNull("the rate saved");

    read.ShouldSatisfyAllConditions(
      () => read.CzkPerEur.ToString(CultureInfo.InvariantCulture).ShouldBe(czkPerEur, "the rate, every digit and its scale"),
      () => read.Date.ShouldBe(new DateOnly(2026, 11, 20), "the day"));
  }

  /// <summary>Monday's rate, then Friday's: the store keeps the last one saved, though it is for an earlier day.</summary>
  [Test]
  public async Task A_save_replaces_the_kept_rate() {
    IKorunaRateStore store = NewStore();
    await store.Save(new KorunaRate(24.52m, new DateOnly(2026, 11, 23)), CancellationToken.None);

    await store.Save(new KorunaRate(24.41m, new DateOnly(2026, 11, 20)), CancellationToken.None);

    (await store.Read(CancellationToken.None)).ShouldBe(new KorunaRate(24.41m, new DateOnly(2026, 11, 20)), "the last rate saved, whole");
  }

  /// <summary>A new, empty store of the test's own.</summary>
  protected abstract IKorunaRateStore NewStore();
}