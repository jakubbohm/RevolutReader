namespace RevolutReader.Api.DataProtection;

public static class DataProtectionKeysRegistration {
  /// <summary>Throws at registration when the settings are partly set; the message names the settings, not their values.</summary>
  public static IServiceCollection AddDataProtectionKeys(this IServiceCollection services, DataProtectionKeysOptions options) => throw new NotImplementedException();
}