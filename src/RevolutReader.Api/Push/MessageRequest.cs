using System.Text.Json.Serialization;

namespace RevolutReader.Api.Push;

/// <summary>
/// The owner's message (c011 design.md D10): the target account (an email address) and the message, its title, its
/// optional text and the optional page a tap opens. Every member optional here, so a missing one is the endpoint's
/// refusal, naming it, never a binding failure. Temporary, for the iPhone test of #113: an optional made-up balance,
/// <paramref name="Test"/>.
/// </summary>
public sealed record MessageRequest(string? Account, string? Title, string? Text, string? Page, TestBalanceRequest? Test = null);

/// <summary>
/// Temporary, for the iPhone test of #113: a made-up balance, in the shape of the account's (<see cref="PushBalance"/>).
/// Every member required, so a test balance that is not a whole balance makes the body unreadable.
/// </summary>
public sealed record TestBalanceRequest(
  [property: JsonRequired] decimal Amount,
  [property: JsonRequired] DateTimeOffset ReadAt,
  [property: JsonRequired] decimal CzkPerEur);