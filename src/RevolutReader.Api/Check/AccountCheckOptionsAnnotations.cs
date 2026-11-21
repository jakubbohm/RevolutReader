using Microsoft.Extensions.Options;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Check;

/// <summary>
/// <see cref="AccountCheckOptions"/>'s data annotations, checked by code generated at compile time, never by
/// <c>ValidateDataAnnotations</c>, whose shared <c>RangeAttribute</c> is not thread-safe (#68, configuration.md § Binding).
/// Registered through <see cref="SectionBinding.BindSection{TOptions}"/>, which names each failure in full. A class of its
/// own, apart from <see cref="AccountCheckOptionsValidator"/>: the generator refuses a class that validates by hand too
/// (SYSLIB1205).
/// </summary>
[OptionsValidator]
public sealed partial class AccountCheckOptionsAnnotations : IValidateOptions<AccountCheckOptions>;