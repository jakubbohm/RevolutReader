using Microsoft.Extensions.Options;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Push;

/// <summary>
/// <see cref="PushOptions"/>'s data annotations, checked by code generated at compile time, never by
/// <c>ValidateDataAnnotations</c>: its range check of the request timeout is thread-safe, unlike <c>RangeAttribute</c>
/// there (#68, configuration.md § Binding). Registered through <see cref="SectionBinding.BindSection{TOptions}"/>, which
/// names each failure in full. A class of its own, apart from <see cref="PushOptionsValidator"/>: the generator refuses a
/// class that validates by hand too (SYSLIB1205).
/// </summary>
[OptionsValidator]
public sealed partial class PushOptionsAnnotations : IValidateOptions<PushOptions>;