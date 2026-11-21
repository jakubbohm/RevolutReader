using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>One check (c014 design.md D3, D4, D10, D12), its three steps: read and compare, store, notify.</summary>
public interface IAccountCheck {
  /// <summary>
  /// Reads the balance for <paramref name="user"/>; on success keeps it as last seen (both, the first time). Then, unless
  /// <paramref name="anotherCheckWaits"/> says a check waits behind it, notifies a change from the stored balances and
  /// writes last notified. A failed read is the result, whatever the notify step did; storage failures throw.
  /// </summary>
  Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken);
}