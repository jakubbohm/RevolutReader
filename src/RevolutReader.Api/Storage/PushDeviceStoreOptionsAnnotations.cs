using Microsoft.Extensions.Options;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="PushDeviceStoreOptions"/>'s data annotations, checked by code generated at compile time, never by
/// <c>ValidateDataAnnotations</c>, whose shared <c>RangeAttribute</c> is not thread-safe (#68, configuration.md § Binding).
/// Registered through <see cref="SectionBinding.BindSection{TOptions}"/>, which names each failure in full.
/// </summary>
[OptionsValidator]
public sealed partial class PushDeviceStoreOptionsAnnotations : IValidateOptions<PushDeviceStoreOptions>;