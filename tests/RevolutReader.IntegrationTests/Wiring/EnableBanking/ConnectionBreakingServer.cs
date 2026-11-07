using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A server on a free loopback port that starts every answer and breaks the connection before it ends: it reads the
/// request, sends a success status with headers that promise a 1000-byte JSON body, sends a few bytes of it, and closes
/// the connection. WireMock.Net cannot do this: its "malformed chunk" fault still ends the answer properly. Disposing it
/// stops the server and waits for it, so a fault in the server fails the test that used it instead of going unobserved.
/// </summary>
public sealed class ConnectionBreakingServer : IAsyncDisposable {
  private static readonly byte[] _endOfHeaders = "\r\n\r\n"u8.ToArray();

  private static readonly byte[] _startOfAnAnswer = Encoding.ASCII.GetBytes(
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"balances\": [");

  private readonly TcpListener _listener = new(IPAddress.Loopback, port: 0);
  private readonly CancellationTokenSource _stopping = new();
  private readonly Task _serving;

  /// <summary>Where the server listens.</summary>
  public Uri Address { get; }

  public ConnectionBreakingServer() {
    _listener.Start();
    Address = new Uri($"http://{IPAddress.Loopback}:{((IPEndPoint)_listener.LocalEndpoint).Port}/");
    _serving = ServeAsync(_stopping.Token);
  }

  /// <summary>Answers one connection after another until <see cref="DisposeAsync"/> cancels <paramref name="stopping"/>.</summary>
  private async Task ServeAsync(CancellationToken stopping) {
    try {
      while (true) {
        using TcpClient connection = await _listener.AcceptTcpClientAsync(stopping);
        NetworkStream stream = connection.GetStream();

        await ReadRequestHeaders(stream, stopping);
        await stream.WriteAsync(_startOfAnAnswer, stopping);
      }
    }
    catch (OperationCanceledException) when (stopping.IsCancellationRequested) {
      // Disposed: the server stops.
    }
  }

  /// <summary>Reads until the end of the request's headers, so closing sends the client our bytes, not a reset.</summary>
  private static async Task ReadRequestHeaders(NetworkStream stream, CancellationToken stopping) {
    List<byte> received = [];
    byte[] buffer = new byte[4096];

    while (!EndsWithEndOfHeaders(received)) {
      int read = await stream.ReadAsync(buffer, stopping);

      if (read == 0)
        return;

      received.AddRange(buffer.AsSpan(0, read));
    }
  }

  private static bool EndsWithEndOfHeaders(List<byte> received) => CollectionsMarshal.AsSpan(received).EndsWith(_endOfHeaders);

  #region IAsyncDisposable

  /// <summary>
  /// Stops the server and waits for it, rethrowing what faulted it; frees the port only then, so the loop never calls a
  /// stopped listener.
  /// </summary>
  public async ValueTask DisposeAsync() {
    await _stopping.CancelAsync();

    try {
      await _serving;
    }
    finally {
      _listener.Dispose();
      _stopping.Dispose();
    }
  }

  #endregion
}