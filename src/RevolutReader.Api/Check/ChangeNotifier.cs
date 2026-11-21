using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Check;

/// <summary>Sends a change to every account on the allowlist, one at a time, through <see cref="SendPushHandler"/> (c014 design.md D5); sums the counts.</summary>
public sealed class ChangeNotifier {
  public ChangeNotifier(Allowlist allowlist, SendPushHandler sender, ILogger<ChangeNotifier> logger) {
    ArgumentNullException.ThrowIfNull(allowlist);
    ArgumentNullException.ThrowIfNull(sender);
    ArgumentNullException.ThrowIfNull(logger);
  }

  public Task Send(PushMessage message, CancellationToken cancellationToken) => throw new NotImplementedException();
}