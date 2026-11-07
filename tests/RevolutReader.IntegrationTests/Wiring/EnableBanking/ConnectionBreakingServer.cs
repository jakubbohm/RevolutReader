using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A server on a free loopback port that starts every answer and breaks the connection before it ends: it reads the
/// request, sends a success status with headers that promise a 1000-byte JSON body, sends a few bytes of it, and closes
/// the connection. WireMock.Net cannot do this: its "malformed chunk" fault still ends the answer properly.
/// </summary>
public sealed class ConnectionBreakingServer : IDisposable {
  private static readonly byte[] _endOfHeaders = "\r\n\r\n"u8.ToArray();

  private static readonly byte[] _startOfAnAnswer = Encoding.ASCII.GetBytes(
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"balances\": [");

  private readonly TcpListener _listener = new(IPAddress.Loopback, port: 0);

  /// <summary>Where the server listens.</summary>
  public Uri Address { get; }

  public ConnectionBreakingServer() {
    _listener.Start();
    Address = new Uri($"http://{IPAddress.Loopback}:{((IPEndPoint)_listener.LocalEndpoint).Port}/");
    _ = ServeAsync();
  }

  private async Task ServeAsync() {
    while (true) {
      TcpClient connection;

      try {
        connection = await _listener.AcceptTcpClientAsync();
      }
      catch (ObjectDisposedException) {
        return;
      }
      catch (SocketException) {
        return;
      }

      using (connection) {
        NetworkStream stream = connection.GetStream();

        await ReadRequestHeaders(stream);
        await stream.WriteAsync(_startOfAnAnswer);
      }
    }
  }

  /// <summary>Reads until the end of the request's headers, so closing sends the client our bytes, not a reset.</summary>
  private static async Task ReadRequestHeaders(NetworkStream stream) {
    List<byte> received = [];
    byte[] buffer = new byte[4096];

    while (!EndsWithEndOfHeaders(received)) {
      int read = await stream.ReadAsync(buffer);

      if (read == 0)
        return;

      received.AddRange(buffer.AsSpan(0, read));
    }
  }

  private static bool EndsWithEndOfHeaders(List<byte> received) => CollectionsMarshal.AsSpan(received).EndsWith(_endOfHeaders);

  #region IDisposable

  public void Dispose() => _listener.Dispose();

  #endregion
}