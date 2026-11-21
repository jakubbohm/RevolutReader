using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check at a time, at most one waiting, later callers joining it (c014 design.md D10). A singleton. Each check runs in
/// its own DI scope (<see cref="IAccountCheck"/>) on <see cref="IHostApplicationLifetime.ApplicationStopping"/>, never a
/// caller's token (D8), so a caller that leaves never stops it; a failed check is logged here
/// (<see cref="CheckLog.CheckFailed"/>), since its caller may have left (D15), and never blocks the next.
/// <para>
/// Built so far (c014 tasks.md 8): a call starts its own check at once. The waiting check, callers joining it, and what
/// <c>anotherCheckWaits</c> answers come with c014 tasks.md 35, under one lock over the running check's and the waiting
/// one's tasks (D10).
/// </para>
/// </summary>
public sealed class AccountCheckQueue(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime, ILogger<AccountCheckQueue> logger) {
  /// <summary>No check waits behind the running one, until the waiting check is built (c014 tasks.md 35).</summary>
  private static readonly Func<bool> _noCheckWaits = static () => false;

  /// <summary>How many calls wait behind the running check (the waiting one and those joined to it); read by the acceptance driver (D16).</summary>
  /// <remarks>A test-first stub: a property may not throw <see cref="NotImplementedException"/> (CA1065), so it throws <see cref="NotSupportedException"/> until it is built.</remarks>
  public int CallersWaiting => throw new NotSupportedException("Not built yet: c014 tasks.md 35.4.");

  /// <summary>Starts a check, makes this call the waiting one, or joins the waiting one; the task ends with that check.</summary>
  public Task<BankResult<CheckOutcome>> Check(PresentUser user) {
    ArgumentNullException.ThrowIfNull(user);

    return Run(user, lifetime.ApplicationStopping);
  }

  /// <summary>
  /// One check for <paramref name="user"/>, in a DI scope of its own, on <paramref name="stopping"/>: its result, or its
  /// exception, logged once here before it reaches any caller.
  /// </summary>
  private async Task<BankResult<CheckOutcome>> Run(PresentUser user, CancellationToken stopping) {
    await using AsyncServiceScope scope = scopes.CreateAsyncScope();
    IAccountCheck check = scope.ServiceProvider.GetRequiredService<IAccountCheck>();

    try {
      return await check.Run(user, _noCheckWaits, stopping);
    }
    catch (Exception exception) {
      CheckLog.CheckFailed(logger, exception);

      throw;
    }
  }
}