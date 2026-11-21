using System.Net;
using System.Net.Sockets;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A loopback address nothing listens at, and nothing else can take while this lives: a TCP socket bound to a free port of
/// <c>127.0.0.1</c> that never listens. A connection to it is refused (the system answers it with a reset, on Windows and
/// on Linux alike, as for any port no socket listens on), and since the port stays bound, no server a parallel test starts
/// can be given it, unlike a server's port freed by stopping it, which the next free-port bind may hand out again. Reuse
/// of the address is switched off, and on Windows the binding is exclusive, so not even a socket asking for the address
/// with reuse can share it. Disposing it frees the port.
/// </summary>
public sealed class UnlistenedPort : IDisposable {
  private readonly Socket _socket = new(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);

  /// <summary>The address, <c>http://127.0.0.1:&lt;port&gt;/</c>: where a client finds nothing listening.</summary>
  public Uri Address { get; }

  public UnlistenedPort() {
    if (OperatingSystem.IsWindows())
      _socket.ExclusiveAddressUse = true;

    _socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, false);
    _socket.Bind(new IPEndPoint(IPAddress.Loopback, port: 0));
    Address = new Uri($"http://{IPAddress.Loopback}:{((IPEndPoint)_socket.LocalEndPoint!).Port}/");
  }

  #region IDisposable

  public void Dispose() => _socket.Dispose();

  #endregion
}