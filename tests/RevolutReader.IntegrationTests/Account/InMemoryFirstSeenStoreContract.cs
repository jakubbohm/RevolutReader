using RevolutReader.Api.Account;
using RevolutReader.UnitTests.Account;
using Shouldly;

namespace RevolutReader.IntegrationTests.Account;

/// <summary>
/// The store's contract (<see cref="FirstSeenStoreContract"/>) on the unit tests' in-memory fake, compiled here from its
/// own file (c018 design.md § Ports and contracts). One case is the fake's alone: nothing to read or record counts no
/// request, as the adapter sends none (tasks.md 4.5, the fake's counts).
/// </summary>
[InheritsTests]
public sealed class InMemoryFirstSeenStoreContract : FirstSeenStoreContract {
  [Test]
  public async Task Nothing_to_read_or_record_sends_no_request() {
    InMemoryFirstSeenStore store = new();

    IReadOnlyDictionary<string, DateTimeOffset> read = await store.Read([], CancellationToken.None);
    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record([], CancellationToken.None);

    store.ShouldSatisfyAllConditions(
      () => read.ShouldBeEmpty("what Read answers"),
      () => recorded.ShouldBeEmpty("what Record answers"),
      () => store.ReadRequests.ShouldBe(0, "the reads counted"),
      () => store.RecordRequests.ShouldBe(0, "the records counted"));
  }

  protected override IFirstSeenStore NewStore() => new InMemoryFirstSeenStore();
}