using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A server on a free loopback port that starts every answer and breaks the connection before it ends: it reads the
/// request, sends a success status with headers that promise a 1000-byte JSON body, sends a few bytes of it, and closes
/// the connection. WireMock.Net cannot do this: its "malformed chunk" fault still ends the answer properly. Given a body
/// for later answers, it breaks only the first answer and answers every later request whole. A client that hangs up ends
/// only its own connection. Disposing it stops the server and waits for it, so any other fault in the server fails the
/// test that used it instead of going unobserved; disposing it again does nothing.
/// </summary>
public sealed class ConnectionBreakingServer : IAsyncDisposable {
  private static readonly byte[] _endOfHeaders = "\r\n\r\n"u8.ToArray();

  private static readonly byte[] _startOfAnAnswer = Encoding.ASCII.GetBytes(
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{\"balances\": [");

  private readonly TcpListener _listener = new(IPAddress.Loopback, port: 0);
  private readonly CancellationTokenSource _stopping = new();
  private readonly Task _serving;

  /// <summary>The whole answer to every request after the first; <see langword="null"/> when every answer breaks.</summary>
  private readonly byte[]? _laterAnswer;

  private int _requestsReceived;

  /// <summary>Where the server listens.</summary>
  public Uri Address { get; }

  /// <summary>How many requests reached the server so far: each one whose headers came in whole, answered or not.</summary>
  public int RequestsReceived => Volatile.Read(ref _requestsReceived);

  /// <param name="laterAnswerBody">
  /// None: every answer breaks. A JSON body: only the first answer breaks, and every later request is answered whole with a
  /// success status and this body, its connection closed after it.
  /// </param>
  public ConnectionBreakingServer(string? laterAnswerBody = null) {
    _laterAnswer = laterAnswerBody is null ? null : WholeAnswer(laterAnswerBody);
    _listener.Start();
    Address = new Uri($"http://{IPAddress.Loopback}:{((IPEndPoint)_listener.LocalEndpoint).Port}/");
    _serving = ServeAsync(_stopping.Token);
  }

  /// <summary>Answers one connection after another until <see cref="DisposeAsync"/> cancels <paramref name="stopping"/>.</summary>
  private async Task ServeAsync(CancellationToken stopping) {
    try {
      while (true) {
        TcpClient connection;

        try {
          connection = await _listener.AcceptTcpClientAsync(stopping);
        }
        catch (SocketException hangUp) when (hangUp.SocketErrorCode == SocketError.ConnectionReset) {
          // Reset before it was accepted; it is gone, so the next accept takes the next connection or sees the stopping.
          continue;
        }

        using (connection)
          await Answer(connection.GetStream(), stopping);
      }
    }
    catch (OperationCanceledException) when (stopping.IsCancellationRequested) {
      // Disposed: the server stops.
    }
  }

  /// <summary>
  /// Answers one connection: the start of an answer that breaks, or, after the first request when there is one, the whole
  /// later answer. The client hanging up ends only this connection.
  /// </summary>
  private async Task Answer(NetworkStream stream, CancellationToken stopping) {
    try {
      if (await ReadRequestHeaders(stream, stopping))
        Interlocked.Increment(ref _requestsReceived);

      await stream.WriteAsync(_laterAnswer is not null && RequestsReceived > 1 ? _laterAnswer : _startOfAnAnswer, stopping);
    }
    catch (IOException failure) when (failure.InnerException is SocketException hangUp && IsHangUp(hangUp)) {
      // The client hung up: the server goes on to the next connection.
    }
  }

  /// <summary>A success answer with this JSON body, whole, that tells the client the connection closes after it.</summary>
  private static byte[] WholeAnswer(string body) {
    byte[] content = Encoding.UTF8.GetBytes(body);
    byte[] head = Encoding.ASCII.GetBytes(
      $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {content.Length}\r\nConnection: close\r\n\r\n");

    return [.. head, .. content];
  }

  /// <summary>The other side reset or aborted the connection, or shut it down (a broken pipe, on Linux).</summary>
  private static bool IsHangUp(SocketException failure) =>
    failure.SocketErrorCode is SocketError.ConnectionReset or SocketError.ConnectionAborted or SocketError.Shutdown;

  /// <summary>
  /// Reads until the end of the request's headers, so closing sends the client our bytes, not a reset; false when the
  /// client ended the connection before they came in whole.
  /// </summary>
  private static async Task<bool> ReadRequestHeaders(NetworkStream stream, CancellationToken stopping) {
    List<byte> received = [];
    byte[] buffer = new byte[4096];

    while (!EndsWithEndOfHeaders(received)) {
      int read = await stream.ReadAsync(buffer, stopping);

      if (read == 0)
        return false;

      received.AddRange(buffer.AsSpan(0, read));
    }

    return true;
  }

  private static bool EndsWithEndOfHeaders(List<byte> received) => CollectionsMarshal.AsSpan(received).EndsWith(_endOfHeaders);

  #region IAsyncDisposable

  private int _disposed;

  /// <summary>
  /// Stops the server and waits for it, rethrowing what faulted it (a client hanging up never does); frees the port only
  /// then, so the loop never calls a stopped listener. Disposing again does nothing.
  /// </summary>
  public async ValueTask DisposeAsync() {
    if (Interlocked.Exchange(ref _disposed, 1) == 1)
      return;

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