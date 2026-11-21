using System.Diagnostics;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Check;

/// <summary>
/// Sends a change to every account on the allowlist (<see cref="Allowlist.Addresses"/>, in the order written), one at a
/// time, through <see cref="SendPushHandler"/> (c014 design.md D5): an account with no registered device answers three
/// zeros. Sums the counts and logs them (<see cref="CheckLog.ChangeSent"/>, D15), never an account's address. The sender's
/// failures (the device table's) pass on as its exceptions.
/// </summary>
public sealed class ChangeNotifier(Allowlist allowlist, SendPushHandler sender, ILogger<ChangeNotifier> logger) {
  public async Task Send(PushMessage message, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(message);

    int delivered = 0;
    int failed = 0;
    int removed = 0;

    foreach (string account in allowlist.Addresses) {
      PushSent sent = await sender.Send(account, message, cancellationToken) switch {
        PushSent counts => counts,
        AccountNotAllowed => throw new UnreachableException("An account on the allowlist was refused as not on it."),
      };

      delivered += sent.Delivered;
      failed += sent.Failed;
      removed += sent.Removed;
    }

    CheckLog.ChangeSent(logger, allowlist.Addresses.Count, delivered, failed, removed);
  }
}