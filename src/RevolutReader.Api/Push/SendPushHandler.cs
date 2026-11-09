using Microsoft.Extensions.Options;
using RevolutReader.Api.SignIn;

namespace RevolutReader.Api.Push;

/// <summary>
/// The sender (c011 design.md D2, D3, D4): the allowlist first; then every device of the account, at once, each with the
/// message's Declarative Web Push JSON; counts logged. C9 sends through <see cref="Send"/>.
/// </summary>
public sealed class SendPushHandler {
  public SendPushHandler(IPushDeviceStore store, IPushDelivery delivery, Allowlist allowlist, IOptions<PushOptions> options, ILogger<SendPushHandler> logger) =>
    throw new NotImplementedException();

  public Task<SendResult> Send(string account, PushMessage message, CancellationToken cancellationToken) => throw new NotImplementedException();
}