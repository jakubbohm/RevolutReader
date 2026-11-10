namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A push a phone's push service received (spec push-sending, c011 design.md D2, D7), as the phone reads it: the
/// Declarative Web Push message it decrypts to, how long the push service is to keep it and how urgent it is, whether it
/// was signed with the server's push key for that push service, and whether it reached the phone. The driver
/// (<see cref="Drivers.PushDriver"/>) reads the message only when the push's content decrypts with the phone's own keys
/// (RFC 8291, <see cref="Drivers.TestDevice"/>) and is a Declarative Web Push message: JSON with <c>web_push</c> 8030 and
/// a <c>notification</c> holding <c>title</c>, <c>navigate</c> and, when there is text, <c>body</c>, and nothing else;
/// any other content fails the step, naming why.
/// </summary>
/// <param name="Title">The notification's title.</param>
/// <param name="Text">The notification's text (<c>body</c>); <see langword="null"/> when it has none.</param>
/// <param name="Navigate">The address a tap opens.</param>
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
public sealed record PushReceived(string Title, string? Text, string Navigate, int? LifetimeSeconds, string? Urgency, bool SignedWithServerKey, bool ReachedThePhone);