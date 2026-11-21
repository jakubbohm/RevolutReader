using RevolutReader.Api.Check;
using RevolutReader.UnitTests.Check;

namespace RevolutReader.IntegrationTests.Check;

/// <summary>The store's contract (<see cref="CheckedBalanceStoreContract"/>) on the unit tests' in-memory fake, compiled here from its own file (c014 design.md § Ports and contracts).</summary>
[InheritsTests]
public sealed class InMemoryCheckedBalanceStoreContract : CheckedBalanceStoreContract {
  protected override ICheckedBalanceStore NewStore() => new InMemoryCheckedBalanceStore();
}