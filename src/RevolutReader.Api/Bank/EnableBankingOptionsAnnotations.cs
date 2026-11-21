using Microsoft.Extensions.Options;
using RevolutReader.Api.Configuration;

namespace RevolutReader.Api.Bank;

/// <summary>
/// <see cref="EnableBankingOptions"/>'s data annotations, checked by code generated at compile time, never by
/// <c>ValidateDataAnnotations</c>: its range checks of the two times are thread-safe, unlike <c>RangeAttribute</c> there
/// (#68, configuration.md § Binding). Registered through <see cref="SectionBinding.BindSection{TOptions}"/>, which names
/// each failure in full. A class of its own, apart from <see cref="EnableBankingOptionsValidator"/>: the generator refuses
/// a class that validates by hand too (SYSLIB1205).
/// </summary>
[OptionsValidator]
public sealed partial class EnableBankingOptionsAnnotations : IValidateOptions<EnableBankingOptions>;