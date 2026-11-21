using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Configuration;

/// <summary>How every settings section is bound and checked (configuration.md § Binding).</summary>
internal static class SectionBinding {
  /// <summary>
  /// Binds the settings to <paramref name="section"/> and checks them with <paramref name="annotations"/>, the settings
  /// class's generated data-annotation validator (<see cref="OptionsValidatorAttribute"/>), each failure named in full as
  /// <c>Section:Member: …</c> (<see cref="SectionNamedValidator{TOptions}"/>). Not <c>ValidateDataAnnotations</c>, banned
  /// since #68: it shares one <c>RangeAttribute</c> per type across the process, and that attribute sets itself up lazily
  /// without a lock (dotnet/runtime#110917), so app copies starting at the same time could fail with an
  /// <see cref="InvalidCastException"/>. A hand-written validator is registered after this call, so its failures come after
  /// the annotations'.
  /// </summary>
  public static OptionsBuilder<TOptions> BindSection<TOptions>(this OptionsBuilder<TOptions> builder, string section, IValidateOptions<TOptions> annotations)
    where TOptions : class {
    ArgumentNullException.ThrowIfNull(builder);
    ArgumentException.ThrowIfNullOrWhiteSpace(section);
    ArgumentNullException.ThrowIfNull(annotations);

    builder.BindConfiguration(section);
    // Added, never tried: a TryAdd would drop it whenever a hand-written validator of the same settings is already registered.
    builder.Services.AddSingleton<IValidateOptions<TOptions>>(new SectionNamedValidator<TOptions>(builder.Name, section, annotations));

    return builder;
  }
}