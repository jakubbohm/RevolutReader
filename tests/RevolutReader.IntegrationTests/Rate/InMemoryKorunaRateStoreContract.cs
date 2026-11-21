using RevolutReader.Api.Rate;
using RevolutReader.UnitTests.Rate;

namespace RevolutReader.IntegrationTests.Rate;

/// <summary>The store's contract (<see cref="KorunaRateStoreContract"/>) on the unit tests' in-memory fake, compiled here from its own file (c017 design.md § Ports and contracts).</summary>
[InheritsTests]
public sealed class InMemoryKorunaRateStoreContract : KorunaRateStoreContract {
  protected override IKorunaRateStore NewStore() => new InMemoryKorunaRateStore();
}