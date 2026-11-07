using System.ComponentModel.DataAnnotations;

namespace RevolutReader.Api.Configuration;

/// <summary>
/// The shared validator of configuration.md § Binding: a setting still holding the declared placeholder <c>"&lt;secret&gt;"</c>
/// fails validation, so a missing secret stops the app at start-up. The failure names the setting, never its value.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class NotSecretPlaceholderAttribute() : ValidationAttribute(STILL_THE_PLACEHOLDER) {
  /// <summary>Every secret's declared value in <c>appsettings.json</c> (configuration.md).</summary>
  private const string SECRET_PLACEHOLDER = "<secret>";

  /// <summary><c>{0}</c> is the setting's name.</summary>
  private const string STILL_THE_PLACEHOLDER = "The {0} setting still holds the secret placeholder from appsettings.json; provide its real value.";

  protected override ValidationResult? IsValid(object? value, ValidationContext validationContext) {
    ArgumentNullException.ThrowIfNull(validationContext);

    if (value is not string text || !string.Equals(text, SECRET_PLACEHOLDER, StringComparison.Ordinal))
      return ValidationResult.Success;

    string[]? memberNames = validationContext.MemberName is { } memberName ? [memberName] : null;

    return new ValidationResult(FormatErrorMessage(validationContext.DisplayName), memberNames);
  }
}