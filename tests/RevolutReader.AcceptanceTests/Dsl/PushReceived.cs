namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A push a phone's push service received (spec push-sending, c011 design.md D2, D7), as the phone reads it: the
/// Declarative Web Push message it decrypts to, how long the push service is to keep it and how urgent it is, whether it
/// was signed with the server's push key for that push service, and whether it reached the phone. The driver
/// (<see cref="Drivers.PushDriver"/>) reads the message only when the push's content decrypts with the phone's own keys
/// (RFC 8291, <see cref="Drivers.TestDevice"/>) and is a Declarative Web Push message: JSON with <c>web_push</c> 8030, a
/// <c>notification</c> holding <c>title</c> and <c>navigate</c>, strings, <c>body</c>, a string, when there is text, and
/// <c>data</c>, any value, when it has one, and at the top level <c>mutable</c>, any value, when it has one, and nothing
/// else; any other content fails the step, naming why. A <c>data</c> or a <c>mutable</c> is read, never a failed step, so a
/// scenario can pin its absence (c019 design.md D1, D12). Since c019 the balance travels in <c>navigate</c>'s fragment
/// (design.md D2): <c>#balance=&lt;payload&gt;.&lt;code&gt;</c>.
/// </summary>
/// <param name="Title">The notification's title.</param>
/// <param name="Text">The notification's text (<c>body</c>); <see langword="null"/> when it has none.</param>
/// <param name="Navigate">
/// The address a tap opens, without its balance fragment (c019 design.md D12), so a scenario that names the page keeps its
/// claim; an address with a fragment of another kind keeps it.
/// </param>
/// <param name="LifetimeSeconds">How long, in seconds, the push service keeps it while the phone is offline (<c>TTL</c>); <see langword="null"/> when the push gave none.</param>
/// <param name="Urgency">How urgent it is (<c>Urgency</c>: <c>very-low</c>, <c>low</c>, <c>normal</c> or <c>high</c>); <see langword="null"/> when the push gave none.</param>
/// <param name="SignedWithServerKey">
/// Its token is the server's for this push service: an ES256 JWT signed with the server's push key (VAPID), <c>k</c> that
/// key, <c>aud</c> this push service, <c>exp</c> in the future and at most 24 hours ahead, <c>sub</c> an <c>https:</c>
/// address (RFC 8292; <see cref="Drivers.FakePushService"/>).
/// </param>
/// <param name="ReachedThePhone">
/// The push service accepted it for the phone: it passed every check the fake push service makes, and the phone is
/// neither gone nor failing there.
/// </param>
/// <param name="MarkedForServiceWorker">
/// The message is marked for the app's service worker: it has a <c>mutable</c> member at its top level, where the
/// Declarative Web Push parser reads it (c014 design.md D14), whatever its value. <see langword="false"/> when it has none.
/// </param>
/// <param name="CarriesData">The notification has a <c>data</c> member, whatever its value (c019 design.md D1: never).</param>
/// <param name="Balance">
/// The balance in <c>navigate</c>'s fragment (c019 design.md D2): its payload, base64url without padding of UTF-8 JSON,
/// an object of exactly <c>amount</c> and <c>czkPerEur</c>, JSON numbers, and <c>readAt</c>, a JSON string holding an ISO
/// 8601 date and time, read as <see cref="Drivers.BalanceDriver"/> reads <c>GET /api/balance</c>'s answer (its read time
/// as an instant), with no problem. <see langword="null"/> when <c>navigate</c> has no balance fragment; a balance fragment
/// of any other shape fails the step. Read whether its check code is accepted or not.
/// </param>
/// <param name="CheckCodeAccepted">
/// The fragment's check code verifies under the receiving phone's own secret (<see cref="Drivers.TestDevice.Accepts"/>,
/// the kit's own HKDF and HMAC, compared in constant time; c019 design.md D3). <see langword="false"/> without a balance.
/// </param>
/// <param name="BalanceFragment">
/// The raw balance fragment, <c>balance=&lt;payload&gt;.&lt;code&gt;</c> without the <c>#</c>, for another phone to try
/// (<see cref="PhoneForPush.Accepts"/>); <see langword="null"/> without a balance.
/// </param>
public sealed record PushReceived(
  string Title,
  string? Text,
  string Navigate,
  int? LifetimeSeconds,
  string? Urgency,
  bool SignedWithServerKey,
  bool ReachedThePhone,
  bool MarkedForServiceWorker,
  bool CarriesData,
  BalanceReading? Balance,
  bool CheckCodeAccepted,
  string? BalanceFragment);