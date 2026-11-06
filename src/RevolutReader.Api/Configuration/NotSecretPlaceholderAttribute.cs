using System.ComponentModel.DataAnnotations;

namespace RevolutReader.Api.Configuration;

/// <summary>
/// The shared validator of configuration.md § Binding: a setting still holding the declared placeholder <c>"&lt;secret&gt;"</c>
/// fails validation, so a missing secret stops the app at start-up.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class NotSecretPlaceholderAttribute : ValidationAttribute {
  protected override ValidationResult? IsValid(object? value, ValidationContext validationContext) => throw new NotImplementedException();
}