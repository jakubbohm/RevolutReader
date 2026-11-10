namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// The part of a request a refusal names (c011 design.md D9, D10): a refusal's problem description names the refused
/// member, never its value. The driver (<see cref="Drivers.PushDriver"/>) maps the member the problem's errors name, so
/// the API's member names stay in the driver.
/// </summary>
public enum RequestPart {
  /// <summary>A subscription's push address (<c>endpoint</c>).</summary>
  PushAddress,

  /// <summary>A subscription's device key, its P-256 public key (<c>keys.p256dh</c>).</summary>
  DeviceKey,

  /// <summary>A subscription's secret (<c>keys.auth</c>).</summary>
  Secret,

  /// <summary>A message's target account (<c>account</c>).</summary>
  Account,

  /// <summary>A message's title (<c>title</c>).</summary>
  Title,

  /// <summary>A message's page, the one a tap opens (<c>page</c>).</summary>
  Page,

  /// <summary>The message as a whole, too long for a push (<c>message</c>).</summary>
  Message,

  /// <summary>A body that is not the request's JSON (<c>body</c>).</summary>
  Body,
}