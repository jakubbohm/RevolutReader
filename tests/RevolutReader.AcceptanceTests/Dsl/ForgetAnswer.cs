namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What the API answered a browser forgetting its device (spec push-devices, c011 design.md D9). The driver
/// (<see cref="Drivers.PushDriver.Forget"/>) gives <see cref="Forgotten"/> for a success without content (204), whether
/// or not the device was stored. <see cref="SomethingElse"/> is the default value, so an unset answer never reads as
/// forgotten.
/// </summary>
public enum ForgetAnswer {
  SomethingElse,
  Forgotten,
}