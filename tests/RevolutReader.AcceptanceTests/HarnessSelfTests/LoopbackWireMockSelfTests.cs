using System.Net;
using System.Net.NetworkInformation;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;
using WireMock.Server;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// A check of the test harness itself, not of the app: a fake server started through <see cref="LoopbackWireMock"/>
/// listens on this machine's loopback address and on no other, read from the system's own list of listening TCP
/// sockets. One listening on every network interface brings up Windows Defender Firewall's prompt, which needs an
/// administrator, in every folder the tests are built in.
/// </summary>
public sealed class LoopbackWireMockSelfTests {
  [Test]
  public void A_fake_server_listens_on_the_loopback_address_only() {
    using WireMockServer server = LoopbackWireMock.Start();

    IPEndPoint[] listening = [.. IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Where(endpoint => endpoint.Port == server.Port)];

    listening.ShouldNotBeEmpty("the server's port is not among the listening sockets");
    listening.ShouldAllBe(endpoint => IPAddress.IsLoopback(endpoint.Address));
  }
}