using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Configuration;

/// <summary>
/// A settings class's generated data-annotation validator (<see cref="OptionsValidatorAttribute"/>), its failures named in
/// full, as the operator sets the setting (configuration.md § Binding, #68). The generated validator names a failure by the
/// member alone, <c>Key: The …</c>, so each failure gets the section in front: <c>AccountCheck:Key: The …</c>, which is
/// <c>AccountCheck__Key</c> in the environment. The section is put in front, never parsed out of the generated text, so a
/// change to that text upstream (dotnet/runtime#135978) still reaches the operator with the full name. Success and skip
/// pass through. Only the options name it was registered for is validated and any other is skipped, as
/// <c>ValidateDataAnnotations</c> did.
/// </summary>
/// <param name="optionsName">The options name the settings were registered under.</param>
/// <param name="section">The settings' section, as the configuration names it.</param>
/// <param name="annotations">The settings class's generated validator.</param>
internal sealed class SectionNamedValidator<TOptions>(string optionsName, string section, IValidateOptions<TOptions> annotations) : IValidateOptions<TOptions>
  where TOptions : class {
  public ValidateOptionsResult Validate(string? name, TOptions options) {
    if (!string.Equals(name, optionsName, StringComparison.Ordinal))
      return ValidateOptionsResult.Skip;

    ValidateOptionsResult result = annotations.Validate(name, options);

    // A failure from the generated code always lists its failures; one that did not would still fail, as it is.
    return result is { Failed: true, Failures: { } failures }
      ? ValidateOptionsResult.Fail([.. failures.Select(failure => $"{section}:{failure}")])
      : result;
  }
}