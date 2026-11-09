using RevolutReader.Api.Push;
using RevolutReader.UnitTests.Push;

namespace RevolutReader.IntegrationTests.Push;

/// <summary>The store's contract (<see cref="PushDeviceStoreContract"/>) on the unit tests' in-memory fake, compiled here from its own file (c011 design.md § Ports and contracts).</summary>
[InheritsTests]
public sealed class InMemoryPushDeviceStoreContract : PushDeviceStoreContract {
  protected override IPushDeviceStore NewStore() => new InMemoryPushDeviceStore();
}