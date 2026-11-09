using System.Net;
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
/// (D4). A push the service took is <see cref="Delivered"/>; a 404 or 410 answer is <see cref="DeviceGone"/>, with that
/// status; any other answer (429 included) is <see cref="DeliveryFailed"/> with its status, and no connection or the
/// client's own timeout (a <see cref="TaskCanceledException"/> over a <see cref="TimeoutException"/>) is
/// <see cref="DeliveryFailed"/> with none (D13). The caller's cancellation is checked first and passes on as cancellation,
/// never as a failed device.
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

    try {
      await _client.RequestPushMessageDeliveryAsync(subscription, message, vapid, VapidAuthenticationScheme.Vapid, cancellationToken);
    }
    catch (PushServiceClientException exception) when (IsGone(exception.StatusCode)) {
      return new DeviceGone((int)exception.StatusCode);
    }
    catch (PushServiceClientException exception) {
      return new DeliveryFailed((int)exception.StatusCode);
    }
    catch (HttpRequestException) {
      return new DeliveryFailed(Status: null);
    }
    catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested && exception.InnerException is TimeoutException) {
      return new DeliveryFailed(Status: null);
    }

    return new Delivered();
  }

  /// <summary>Whether the push service's answer says the device is gone (D3, D13): 404 or 410.</summary>
  private static bool IsGone(HttpStatusCode status) => status is HttpStatusCode.NotFound or HttpStatusCode.Gone;

  private static PushMessageUrgency UrgencyOf(PushUrgency urgency) => urgency switch {
    PushUrgency.VeryLow => PushMessageUrgency.VeryLow,
    PushUrgency.Low => PushMessageUrgency.Low,
    PushUrgency.Normal => PushMessageUrgency.Normal,
    PushUrgency.High => PushMessageUrgency.High,
    _ => throw new ArgumentOutOfRangeException(nameof(urgency), urgency, "Not an urgency RFC 8030 names."),
  };
}