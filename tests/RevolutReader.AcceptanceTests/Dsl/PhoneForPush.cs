namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A phone (or any device) whose browser subscribes for pushes (specs push-devices, push-sending; c011 design.md D7),
/// known by the name the scenario gives it, unique within the test. <see cref="PushDsl"/> keeps the test device behind it
/// (<see cref="Drivers.TestDevice"/>: its push address at the fake push service and its own keys), so a scenario never
/// handles a push address or a key.
/// </summary>
/// <param name="Name">The scenario's name for it, e.g. "Lucie's phone".</param>
public sealed record PhoneForPush(string Name);