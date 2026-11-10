using System.Net;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// A request the fake push service received (c011 design.md D7), as it arrived, and how the fake answered it.
/// </summary>
/// <param name="Path">The path it was sent to: a device's push address is <c>/push/&lt;device&gt;</c>.</param>
/// <param name="Headers">
/// Its headers, looked up ignoring case, as HTTP compares them; a header sent more than once has its values joined with
/// <c>", "</c> (as <see cref="FakeBank"/> records them).
/// </param>
/// <param name="Body">Its body as received, still encrypted.</param>
/// <param name="SignedWithServerKey">
/// Whether its token passed every check of <see cref="FakePushService"/>'s: an ES256 JWT signed with the run's VAPID key,
/// <c>k</c> that key, <c>aud</c> the fake's scheme and host, <c>exp</c> in the future and at most 24 hours ahead,
/// <c>sub</c> an <c>https:</c> address.
/// </param>
/// <param name="Answer">The status the fake answered: 201, or 403 for a failed check, 410 for a gone device, 500 for a failing one.</param>
public sealed record ReceivedPush(string Path, IReadOnlyDictionary<string, string> Headers, ReadOnlyMemory<byte> Body, bool SignedWithServerKey, HttpStatusCode Answer);