using System.ComponentModel.DataAnnotations;

namespace RevolutReader.Api.Storage;

/// <summary>The <c>PushDevices</c> section (c011 design.md D11), validated on start, as <see cref="TransactionStoreOptions"/> is.</summary>
public sealed class PushDeviceStoreOptions {
  public const string SECTION = "PushDevices";

  /// <summary>A name Table Storage accepts: 3 to 63 letters (A to Z) and digits, starting with a letter.</summary>
  private const string TABLE_NAME_PATTERN = "^[A-Za-z][A-Za-z0-9]{2,62}$";

  /// <summary>
  /// The table the push devices are kept in; each acceptance test's app copy has its own. A name Table Storage refuses
  /// fails validation, so the app stops at start instead of failing the first request.
  /// </summary>
  [Required]
  [RegularExpression(TABLE_NAME_PATTERN, ErrorMessage = "{0} must be 3 to 63 letters (A to Z) and digits, starting with a letter: a table name Table Storage accepts.")]
  public required string TableName { get; init; }
}