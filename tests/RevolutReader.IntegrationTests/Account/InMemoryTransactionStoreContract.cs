using RevolutReader.Api.Account;
using RevolutReader.UnitTests.Account;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>The store's contract (<see cref="TransactionStoreContract"/>) on the unit tests' in-memory fake, compiled here from its own file (c010 design.md D12).</summary>
[InheritsTests]
public sealed class InMemoryTransactionStoreContract : TransactionStoreContract {
  protected override ITransactionStore NewStore() => new InMemoryTransactionStore();
}