using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.Extensions.Options;
using LibraryMessage = Lib.Net.Http.WebPush.PushMessage;

namespace RevolutReader.Api.Push;

/// <summary>
/// <see cref="IPushDelivery"/> on Lib.Net.Http.WebPush (c011 design.md D1, D13): each push encrypted for the device
/// (<c>aes128gcm</c>, RFC 8291) and signed with the app's VAPID pair in the <c>vapid</c> scheme (RFC 8292), its contact
/// the app's own address (<c>Push:Subject</c>, D5); <c>TTL</c> from the push's lifetime, and <c>Urgency</c> from its
/// urgency, none for <see cref="PushUrgency.Normal"/> (RFC 8030 § 5.3's default). Sent on its own typed
/// <see cref="HttpClient"/>, whose timeout is <c>Push:RequestTimeout</c> and which has no retry handler; the library's own
/// retry after a 429 is off (D1), so a push is one request. The client keeps the framework's request logging and traces
/// (D4). A push the service took is <see cref="Delivered"/>.
/// <para>
/// The signing key is made for each push and disposed after it (<see cref="VapidAuthentication"/> is
/// <see cref="IDisposable"/>): the sender sends to every device at once, and a key per push shares no signer between
/// them.
/// </para>
/// </summary>
public sealed class WebPushDelivery(HttpClient http, IOptions<PushOptions> options) : IPushDelivery {
  private readonly PushServiceClient _client = new(http) { AutoRetryAfter = false };

  public async Task<DeliveryOutcome> Deliver(PushDevice device, OutgoingPush push, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(device);
    ArgumentNullException.ThrowIfNull(push);

    PushOptions settings = options.Value;
    PushSubscription subscription = new() { Endpoint = device.Endpoint };
    subscription.SetKey(PushEncryptionKeyName.P256DH, device.P256dh);
    subscription.SetKey(PushEncryptionKeyName.Auth, device.Auth);

    LibraryMessage message = new(push.Content) {
      TimeToLive = (int)push.Lifetime.TotalSeconds,
      Urgency = UrgencyOf(push.Urgency),
    };

    using VapidAuthentication vapid = new(settings.VapidPublicKey, settings.VapidPrivateKey) {
      // The contact as an origin, without the trailing "/" an address's path adds (Subject is validated as an https origin).
      Subject = settings.Subject.GetLeftPart(UriPartial.Authority),
    };

    await _client.RequestPushMessageDeliveryAsync(subscription, message, vapid, VapidAuthenticationScheme.Vapid, cancellationToken);

    return new Delivered();
  }

  private static PushMessageUrgency UrgencyOf(PushUrgency urgency) => urgency switch {
    PushUrgency.VeryLow => PushMessageUrgency.VeryLow,
    PushUrgency.Low => PushMessageUrgency.Low,
    PushUrgency.Normal => PushMessageUrgency.Normal,
    PushUrgency.High => PushMessageUrgency.High,
    _ => throw new ArgumentOutOfRangeException(nameof(urgency), urgency, "Not an urgency RFC 8030 names."),
  };
}