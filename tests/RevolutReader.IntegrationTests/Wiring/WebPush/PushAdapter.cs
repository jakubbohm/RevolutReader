using System.Buffers.Text;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RevolutReader.Api.Push;

namespace RevolutReader.IntegrationTests.Wiring.WebPush;

/// <summary>
/// The push adapter (<see cref="WebPushDelivery"/>) as the app registers it (<see cref="PushRegistration.AddPush"/>), on
/// made-up settings: a VAPID pair and a message key generated per app, a made-up app address and push service pattern.
/// The push service a test points a device at is its own fake, never a real one.
/// </summary>
internal sealed class PushAdapter : IAsyncDisposable {
  /// <summary>A Declarative Web Push message, made up; its content does not matter to the adapter's answers.</summary>
  public static readonly OutgoingPush Push = new(
    """{"web_push":8030,"notification":{"title":"Ahoj","navigate":"https://app.example.net/"}}""", TimeSpan.FromHours(24), PushUrgency.High);

  private readonly ServiceProvider _services;
  private readonly IServiceScope _scope;

  /// <param name="requestTimeout">The push client's timeout (<c>Push:RequestTimeout</c>); the setting's default unless given.</param>
  public PushAdapter(TimeSpan? requestTimeout = null) {
    using ECDsa vapid = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    ECParameters key = vapid.ExportParameters(includePrivateParameters: true);

    Dictionary<string, string?> values = new(StringComparer.Ordinal) {
      [$"{PushOptions.SECTION}:{nameof(PushOptions.VapidPublicKey)}"] = Base64Url.EncodeToString([0x04, .. key.Q.X!, .. key.Q.Y!]),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.VapidPrivateKey)}"] = Base64Url.EncodeToString(key.D!),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.MessageKey)}"] = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32)),
      [$"{PushOptions.SECTION}:{nameof(PushOptions.Subject)}"] = "https://app.example.net",
      [$"{PushOptions.SECTION}:{nameof(PushOptions.Services)}:Made-up"] = "https://push.example.net",
    };

    if (requestTimeout is TimeSpan timeout)
      values[$"{PushOptions.SECTION}:{nameof(PushOptions.RequestTimeout)}"] = timeout.ToString("c", CultureInfo.InvariantCulture);

    ServiceCollection services = new();
    services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
    services.AddLogging();
    services.AddPush();

    _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    _scope = _services.CreateScope();
  }

  /// <summary>The adapter, from the app's registration.</summary>
  public IPushDelivery Delivery => _scope.ServiceProvider.GetRequiredService<IPushDelivery>();

  /// <summary>A device at <paramref name="pushAddress"/> with keys as a browser makes them: a P-256 public point and a 16-byte secret.</summary>
  public static PushDevice Device(Uri pushAddress) {
    ArgumentNullException.ThrowIfNull(pushAddress);

    using ECDiffieHellman browser = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    ECParameters point = browser.ExportParameters(includePrivateParameters: false);

    return new PushDevice(
      pushAddress.AbsoluteUri,
      Base64Url.EncodeToString([0x04, .. point.Q.X!, .. point.Q.Y!]),
      Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16)),
      "someone@example.com");
  }

  #region IAsyncDisposable

  public async ValueTask DisposeAsync() {
    _scope.Dispose();
    await _services.DisposeAsync();
  }

  #endregion
}