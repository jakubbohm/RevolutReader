using Microsoft.Extensions.Options;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// The sender (spec push-sending, c011 design.md D2, D3, D4): the devices stored under the account (compared ignoring
/// case, as the allowlist compares accounts) are found first. An account not on the allowlist is refused
/// (<see cref="AccountNotAllowed"/>): its devices are deleted, one Warning line counts them without naming the account,
/// and nothing is sent. Otherwise every one of its devices gets one push at once, each carrying the message's Declarative Web Push JSON
/// on the app's own address (<c>Push:Subject</c>), kept for <see cref="LIFETIME"/> by the push service and sent as urgent.
/// A device its push service reports gone is forgotten at once, with a line of the status only. The answer counts the
/// devices reached, those whose push failed (kept) and those gone (removed); one line of those counts is logged, and
/// nothing of the message, the account or a device. Never retried (D3). A message <see cref="PushMessages.Check"/> refuses is a
/// caller's bug: it throws <see cref="ArgumentException"/>, naming the refused members, never their values (D10). C9
/// sends through <see cref="Send"/>.
/// </summary>
public sealed class SendPushHandler(IPushDeviceStore store, IPushDelivery delivery, Allowlist allowlist, IOptions<PushOptions> options, ILogger<SendPushHandler> logger) {
  /// <summary>How long a push waits at the push service while the device is offline (D2): 24 hours.</summary>
  public static readonly TimeSpan LIFETIME = TimeSpan.FromHours(24);

  /// <summary>Sends <paramref name="message"/> to every device of <paramref name="account"/>, as the class describes.</summary>
  public async Task<SendResult> Send(string account, PushMessage message, CancellationToken cancellationToken) {
    ArgumentException.ThrowIfNullOrWhiteSpace(account);
    ArgumentNullException.ThrowIfNull(message);

    IReadOnlyList<RefusedMember> refused = PushMessages.Check(message, options.Value.Subject);

    if (refused.Count > 0)
      throw new ArgumentException($"A push cannot carry this message; refused: {string.Join(", ", refused.Select(static member => member.Member))}.", nameof(message));

    PushDevice[] devices = [.. (await store.ReadAll(cancellationToken))
      .Where(device => string.Equals(device.Account, account, StringComparison.OrdinalIgnoreCase))];

    if (!allowlist.Allows(account)) {
      foreach (PushDevice device in devices)
        await store.Forget(device.Endpoint, cancellationToken);

      PushLog.PushAccountNotAllowed(logger, removed: devices.Length);

      return new AccountNotAllowed();
    }

    OutgoingPush push = new(PushMessages.DeclarativeJson(message, options.Value.Subject), LIFETIME, PushUrgency.High);
    DeliveryOutcome[] outcomes = await Task.WhenAll(devices.Select(device => DeliverOrForget(device, push, cancellationToken)));

    PushSent sent = new(
      Delivered: outcomes.Count(static outcome => outcome.Value is Delivered),
      Failed: outcomes.Count(static outcome => outcome.Value is DeliveryFailed),
      Removed: outcomes.Count(static outcome => outcome.Value is DeviceGone));
    PushLog.PushSent(logger, sent.Delivered, sent.Failed, sent.Removed);

    return sent;
  }

  /// <summary>
  /// Hands <paramref name="push"/> over for <paramref name="device"/>; a device its push service reports gone is forgotten
  /// at once and logged with the status only (D3, D4).
  /// </summary>
  private async Task<DeliveryOutcome> DeliverOrForget(PushDevice device, OutgoingPush push, CancellationToken cancellationToken) {
    DeliveryOutcome outcome = await delivery.Deliver(device, push, cancellationToken);

    if (outcome.Value is DeviceGone gone) {
      await store.Forget(device.Endpoint, cancellationToken);
      PushLog.PushDeviceGone(logger, gone.Status);
    }
    else if (outcome.Value is DeliveryFailed failed)
      PushLog.PushDeliveryFailed(logger, failed.Status);

    return outcome;
  }
}