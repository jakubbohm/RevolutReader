using RevolutReader.AcceptanceTests.Drivers;

namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// A phone (or any device) whose browser subscribes for pushes (specs push-devices, push-sending; c011 design.md D7),
/// known by the name the scenario gives it, unique within the test. <see cref="PushDsl.NewPhone"/> makes it with the test
/// device behind it (<see cref="Drivers.TestDevice"/>: its push address at the fake push service and its own keys), so a
/// scenario never handles a push address or a key.
/// </summary>
public sealed record PhoneForPush {
  /// <summary>The scenario's name for it, e.g. "Lucie's phone".</summary>
  public string Name { get; }

  /// <summary>The test device behind the phone.</summary>
  internal TestDevice Device { get; }

  internal PhoneForPush(string name, TestDevice device) {
    ArgumentException.ThrowIfNullOrWhiteSpace(name);
    ArgumentNullException.ThrowIfNull(device);

    Name = name;
    Device = device;
  }

  /// <summary>
  /// Whether this phone accepts the check code of <paramref name="push"/>'s balance, a push another phone received, say:
  /// its balance fragment verifies under this phone's own secret (spec account-check; c019 design.md D3, D12).
  /// <see langword="false"/> for a push without a balance.
  /// </summary>
  public bool Accepts(PushReceived push) {
    ArgumentNullException.ThrowIfNull(push);

    return push.BalanceFragment is string fragment && Device.Accepts(fragment);
  }
}