namespace RevolutReader.Api.Storage;

/// <summary>The <c>PushDevices</c> section (c011 design.md D11).</summary>
public sealed class PushDeviceStoreOptions {
  public const string SECTION = "PushDevices";

  /// <summary>The table the push devices are kept in; each acceptance test's app copy has its own.</summary>
  public required string TableName { get; init; }
}