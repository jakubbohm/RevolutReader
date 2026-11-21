using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check at a time, at most one waiting, later callers joining it (c014 design.md D10). A singleton. Each check runs in
/// its own DI scope (<see cref="IAccountCheck"/>) on <see cref="IHostApplicationLifetime.ApplicationStopping"/>, never a
/// caller's token (D8); a failed check is logged here (<see cref="CheckLog.CheckFailed"/>) and never blocks the next.
/// </summary>
public sealed class AccountCheckQueue {
  public AccountCheckQueue(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime, ILogger<AccountCheckQueue> logger) {
    ArgumentNullException.ThrowIfNull(scopes);
    ArgumentNullException.ThrowIfNull(lifetime);
    ArgumentNullException.ThrowIfNull(logger);
  }

  /// <summary>Starts a check, makes this call the waiting one, or joins the waiting one; the task ends with that check.</summary>
  public Task<BankResult<CheckOutcome>> Check(PresentUser user) => throw new NotImplementedException();
}