using System.Net.Sockets;
using System.Text;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// The test server itself (<see cref="ConnectionBreakingServer"/>): a client that hangs up does not stop it, and disposing
/// it twice is harmless. Every wait on the network is bounded, so a broken server fails these tests instead of hanging them.
/// </summary>
public sealed class ConnectionBreakingServerTests {
  private static readonly TimeSpan _waitAtMost = TimeSpan.FromSeconds(5);
  private static readonly byte[] _partOfTheHeaders = "GET /accounts HTTP/1.1\r\n"u8.ToArray();
  private static readonly byte[] _wholeRequest = "GET /accounts HTTP/1.1\r\nHost: localhost\r\n\r\n"u8.ToArray();
  private const string START_OF_THE_ANSWER = "HTTP/1.1 200 OK";

  [Test]
  public async Task A_client_that_hangs_up_abruptly_ends_only_its_own_connection() {
    ConnectionBreakingServer server = new();

    await HangUpAbruptly(server.Address);
    string answer = await StartOfTheAnswerTo(server.Address);
    Task disposing = server.DisposeAsync().AsTask().WaitAsync(_waitAtMost);

    answer.ShouldStartWith(START_OF_THE_ANSWER, customMessage: "The next client got no answer after one hung up.");
    await Should.NotThrowAsync(disposing);
  }

  [Test]
  public async Task Disposing_the_server_twice_does_nothing() {
    ConnectionBreakingServer server = new();
    await server.DisposeAsync().AsTask().WaitAsync(_waitAtMost);

    await Should.NotThrowAsync(server.DisposeAsync().AsTask().WaitAsync(_waitAtMost));
  }

  /// <summary>
  /// Connects, sends part of a request's headers, and resets the connection instead of ending it. A raw socket, because
  /// disposing a TcpClient or its stream first ends the connection properly, which the server reads as an ordinary end.
  /// </summary>
  private static async Task HangUpAbruptly(Uri address) {
    using CancellationTokenSource inTime = new(_waitAtMost);
    using Socket client = new(SocketType.Stream, ProtocolType.Tcp);
    await client.ConnectAsync(address.Host, address.Port, inTime.Token);
    await client.SendAsync(_partOfTheHeaders, SocketFlags.None, inTime.Token);

    // The partial headers keep the server waiting in its read for the rest; the pause lets it get there, so the reset
    // below breaks that read (a reset before the server accepts could vanish unseen and prove nothing).
    await Task.Delay(TimeSpan.FromMilliseconds(500), inTime.Token);
    client.LingerState = new LingerOption(enable: true, seconds: 0);
  }

  /// <summary>Sends a whole request and returns the start of the answer, or what came before the wait ran out.</summary>
  private static async Task<string> StartOfTheAnswerTo(Uri address) {
    using CancellationTokenSource inTime = new(_waitAtMost);
    using TcpClient client = new();
    List<byte> received = [];

    try {
      await client.ConnectAsync(address.Host, address.Port, inTime.Token);
      NetworkStream stream = client.GetStream();
      await stream.WriteAsync(_wholeRequest, inTime.Token);
      byte[] buffer = new byte[1024];

      while (received.Count < START_OF_THE_ANSWER.Length) {
        int read = await stream.ReadAsync(buffer, inTime.Token);

        if (read == 0)
          break;

        received.AddRange(buffer.AsSpan(0, read));
      }
    }
    catch (OperationCanceledException) when (inTime.IsCancellationRequested) {
      // The wait ran out: the answer is what came until then.
    }

    return Encoding.ASCII.GetString([.. received]);
  }
}