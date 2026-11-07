namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>A present user, as the bank must see them (spec bank-reads): the device's IP address and its browser.</summary>
public sealed record UserAtDevice(string IpAddress, string Browser);