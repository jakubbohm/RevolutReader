using WireMock.Server;
using WireMock.Settings;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Starts every WireMock.Net server the tests use, on this machine's loopback address only, at a free port. Started
/// without an address, WireMock.Net listens on every network interface (Kestrel's <c>ListenAnyIP</c>), and on Windows a
/// program that does brings up Windows Defender Firewall's prompt, which needs an administrator, once for every path it
/// runs from: each worktree builds its own test executables. A server on the loopback address never brings it up. The
/// address is the IP address itself: WireMock.Net 2.21.0 listens on every interface for <c>localhost</c> with port 0.
/// The integration project compiles this same file; <c>BannedSymbols.txt</c> bans WireMock.Net's own start methods
/// everywhere else. Checked by <c>HarnessSelfTests/LoopbackWireMockSelfTests</c>.
/// </summary>
public static class LoopbackWireMock {
  /// <summary>The loopback address with port 0, so the system picks a free port; the server's <c>Url</c> and <c>Port</c> give the one it got.</summary>
  private const string LOOPBACK_ANY_PORT = "http://127.0.0.1:0";

  /// <summary>
  /// A WireMock.Net server with <paramref name="settings"/> (none: WireMock.Net's defaults), listening on the loopback
  /// address only. The address is this method's: settings that name addresses of their own are a bug.
  /// </summary>
  public static WireMockServer Start(WireMockServerSettings? settings = null) {
    settings ??= new WireMockServerSettings();
    if (settings.Urls is not null)
      throw new ArgumentException("The address of a test's WireMock.Net server is LoopbackWireMock's own; name none in its settings.", nameof(settings));
    settings.Urls = [LOOPBACK_ANY_PORT];
#pragma warning disable RS0030 // The one place a WireMock.Net server starts (BannedSymbols.txt).
    return WireMockServer.Start(settings);
#pragma warning restore RS0030
  }
}