using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using RevolutReader.Api.Configuration;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using RevolutReader.Api.Storage;
using RevolutReader.UnitTests.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Configuration;

/// <summary>
/// Every settings failure names each setting in full, <c>Section:Member: …</c>, never a value (configuration.md § Binding).
/// <c>BindSection</c> puts <c>Section:</c> in front of each failure of a settings class's generated validator, which writes a
/// failure as <c>Member: text</c>, so the result is the full name only while each failure names exactly one member, the
/// member itself (#68 review finding 2). Five shapes would break that, and no settings test would notice until a class took
/// one on: a custom check that builds its own result with no member (<c>Push:The … setting …</c>) or with two
/// (<c>Push:A, B: …</c>); nested validation, <see cref="ValidateObjectMembersAttribute"/> or
/// <see cref="ValidateEnumeratedItemsAttribute"/> (<c>Push:Prop: …</c> instead of <c>Push:Inner:Prop: …</c>); a
/// self-validating class, <see cref="IValidatableObject"/>, whose failures come under the member <c>Validate</c>; and a
/// check on the class as a whole, a <see cref="ValidationAttribute"/> on the settings class itself, which the generated
/// validator either skips, so the rule never runs, or reports without a member (<c>Push:The …</c>). So this guard fails when
/// a settings class takes one of them on: a nested or self-validating check needs the wrapper extended first, a check on the
/// class as a whole is refused, and a custom check that builds its own result passes only with a test that pins its full
/// name through the app's registrations. The wrapper never parses the generated text (the owner, #68), so the guard does not
/// either.
/// </summary>
public sealed class SettingsFailureNamingTests {
  /// <summary>Where the rule lives, and what to do when this guard fails.</summary>
  private const string RULE = "docs/conventions/configuration.md § Binding";

  /// <summary>Every member the generated validator could validate: the settings' own, public or not.</summary>
  private const BindingFlags MEMBERS = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

  /// <summary>
  /// The custom checks that build their own result (they override <c>IsValid(object?, ValidationContext)</c>), each with the
  /// test that pins, through the app's registrations, that its failure names the setting in full. The test's name comes from
  /// <see langword="nameof"/>, so the compiler keeps the link.
  /// </summary>
  private static readonly Dictionary<Type, string> _pinnedOwnResults = new() {
    [typeof(NotSecretPlaceholderAttribute)] =
      $"{nameof(AccountCheckOptionsTests)}.{nameof(AccountCheckOptionsTests.An_invalid_check_key_fails_validation_with_a_message_starting_with_its_full_name_never_its_value)}",
  };

  /// <summary>The settings classes with a generated validator today, so the guard cannot pass on finding none.</summary>
  private static readonly Type[] _knownSettings = [
    typeof(AccountCheckOptions),
    typeof(EnableBankingOptions),
    typeof(PushOptions),
    typeof(SignInOptions),
    typeof(CheckedBalanceStoreOptions),
    typeof(PushDeviceStoreOptions),
    typeof(TransactionStoreOptions),
  ];

  /// <summary>The nested validations the generator follows, whose failures name the inner member alone.</summary>
  private static readonly Type[] _nestedValidations = [typeof(ValidateObjectMembersAttribute), typeof(ValidateEnumeratedItemsAttribute)];

  [Test]
  public void Every_settings_class_with_a_generated_validator_names_each_failure_by_one_member_the_member_itself() {
    Type[] settings = [.. SettingsWithGeneratedValidators()];

    _knownSettings.ShouldBeSubsetOf(settings, "the settings classes found with a generated validator, an [OptionsValidator] class");
    settings.SelectMany(NamingProblems).ShouldBeEmpty(
      "a settings failure would not be named in full as Section:Member, since BindSection only puts the section in front: a nested or "
      + "self-validating check needs the wrapper (SectionNamedValidator) extended first, a check on the class as a whole belongs on its "
      + "members or in a hand-written validator, and a custom check that builds its own result "
      + $"needs a test pinning its full name and an entry in {nameof(_pinnedOwnResults)} ({RULE})");
  }

  /// <param name="shape">A shape whose failures would not name one member of its own, each on a fixture settings class.</param>
  [Test]
  [Arguments("a member validated nested, [ValidateObjectMembers]")]
  [Arguments("a list's items validated nested, [ValidateEnumeratedItems]")]
  [Arguments("a self-validating class, IValidatableObject")]
  [Arguments("a custom check that builds its own result, pinned by no test")]
  [Arguments("a check on the class as a whole, a ValidationAttribute on the class")]
  public void The_guard_reports_a_settings_class_whose_failures_would_not_name_one_member_of_its_own(string shape) {
    (Type Settings, string Named) fixture = shape switch {
      "a member validated nested, [ValidateObjectMembers]" => (typeof(NestedSettings), $"{nameof(NestedSettings)}.{nameof(NestedSettings.Inner)}"),
      "a list's items validated nested, [ValidateEnumeratedItems]" => (typeof(ListSettings), $"{nameof(ListSettings)}.{nameof(ListSettings.Items)}"),
      "a self-validating class, IValidatableObject" => (typeof(SelfValidatingSettings), nameof(SelfValidatingSettings)),
      "a custom check that builds its own result, pinned by no test" => (typeof(OwnResultSettings), $"{nameof(OwnResultSettings)}.{nameof(OwnResultSettings.Value)}"),
      "a check on the class as a whole, a ValidationAttribute on the class" => (typeof(ClassCheckedSettings), nameof(ClassCheckedSettings)),
      _ => throw new ArgumentOutOfRangeException(nameof(shape), shape, "Not a known case."),
    };

    NamingProblems(fixture.Settings).ShouldHaveSingleItem().ShouldStartWith($"{fixture.Named}: ");
  }

  [Test]
  public void The_guard_passes_a_settings_class_with_built_in_checks_and_a_custom_check_that_leaves_its_result_to_the_base_class() =>
    NamingProblems(typeof(CleanSettings)).ShouldBeEmpty();

  /// <summary>
  /// What the guard rests on: a custom check that overrides only <c>IsValid(object?)</c> gets its failure named by the base
  /// class, with the member it validates and nothing else. Run as the generated validator runs a check: one value, with the
  /// member's name in the context.
  /// </summary>
  [Test]
  public void A_custom_check_overriding_only_IsValid_of_the_value_names_its_failure_by_the_member_it_validates() {
    CleanSettings settings = new() { Text = ValueOnlyCheckAttribute.BROKEN };
    ValidationContext context = new(settings, nameof(CleanSettings), null, null) {
      MemberName = nameof(CleanSettings.Text),
      DisplayName = nameof(CleanSettings.Text),
    };
    List<ValidationResult> results = [];

    bool valid = Validator.TryValidateValue(settings.Text, context, results, [new ValueOnlyCheckAttribute()]);

    valid.ShouldBeFalse();
    results.ShouldHaveSingleItem().MemberNames.ShouldBe([nameof(CleanSettings.Text)]);
  }

  /// <summary>
  /// Every settings class the app checks with a generated validator: the settings type of each <c>[OptionsValidator]</c>
  /// class's <see cref="IValidateOptions{TOptions}"/>.
  /// </summary>
  private static IEnumerable<Type> SettingsWithGeneratedValidators() =>
    typeof(AccountCheckOptions).Assembly.GetTypes()
      .Where(type => type.IsDefined(typeof(OptionsValidatorAttribute), inherit: false))
      .SelectMany(type => type.GetInterfaces())
      .Where(contract => contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(IValidateOptions<>))
      .Select(contract => contract.GenericTypeArguments[0])
      .Distinct();

  /// <summary>
  /// Whatever in <paramref name="settings"/> could give a failure that does not name one member, the member itself, each
  /// starting with the class and, where there is one, the member (<c>PushOptions.Services: …</c>); none when every failure
  /// names its own member alone.
  /// </summary>
  private static IEnumerable<string> NamingProblems(Type settings) {
    if (typeof(IValidatableObject).IsAssignableFrom(settings))
      yield return $"{settings.Name}: implements {nameof(IValidatableObject)}, whose failures come under the member \"Validate\" or names of its own choosing";

    foreach (ValidationAttribute check in settings.GetCustomAttributes<ValidationAttribute>(inherit: true))
      yield return $"{settings.Name}: [{check.GetType().Name}] checks the class as a whole, which the generated validator either skips or reports without a member";

    foreach (MemberInfo member in settings.GetMembers(MEMBERS).Where(member => member is PropertyInfo or FieldInfo)) {
      foreach (Type nested in _nestedValidations.Where(nested => member.IsDefined(nested, inherit: false)))
        yield return $"{settings.Name}.{member.Name}: [{nested.Name}] validates its members nested, whose failures name the inner member alone, without {member.Name}";

      foreach (Type check in member.GetCustomAttributes<ValidationAttribute>(inherit: false).Select(check => check.GetType()).Where(BuildsItsOwnResult)) {
        if (!_pinnedOwnResults.ContainsKey(check))
          yield return $"{settings.Name}.{member.Name}: [{check.Name}] overrides IsValid(object?, ValidationContext), so it names the members of its failure itself, maybe none or several";
      }
    }
  }

  /// <summary>
  /// Whether <paramref name="check"/> builds its own result, overriding <c>IsValid(object?, ValidationContext)</c>, and so
  /// chooses the member names itself; one that overrides only <c>IsValid(object?)</c> leaves them to the base class.
  /// </summary>
  private static bool BuildsItsOwnResult(Type check) =>
    check.GetMethod(nameof(ValidationAttribute.IsValid), BindingFlags.Instance | BindingFlags.NonPublic, [typeof(object), typeof(ValidationContext)])?.DeclaringType
      != typeof(ValidationAttribute);

#pragma warning disable CA1812 // The guard reads these fixtures by reflection only, as it reads the real settings classes, so none is ever created.
  /// <summary>A fixture's inner settings, validated nested.</summary>
  private sealed class InnerSettings {
    [Required]
    public string? Name { get; init; }
  }

  /// <summary>A fixture: one member validated nested.</summary>
  private sealed class NestedSettings {
    [ValidateObjectMembers]
    public InnerSettings? Inner { get; init; }
  }

  /// <summary>A fixture: a list whose items are validated nested.</summary>
  private sealed class ListSettings {
    [ValidateEnumeratedItems]
    public IReadOnlyList<InnerSettings>? Items { get; init; }
  }

  /// <summary>A fixture: a class that validates itself.</summary>
  private sealed class SelfValidatingSettings : IValidatableObject {
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext) => [];
  }

  /// <summary>A fixture: a custom check that builds its own result, on no allowlist.</summary>
  private sealed class OwnResultSettings {
    [OwnResultCheck]
    public string? Value { get; init; }
  }

  /// <summary>A fixture: a check on the class as a whole, next to a member checked as it should be.</summary>
  [WholeClassCheck]
  private sealed class ClassCheckedSettings {
    [Required]
    public string? Name { get; init; }
  }
#pragma warning restore CA1812

  /// <summary>A fixture: the shapes that keep each failure to its own member, built-in checks and a check of the value alone.</summary>
  private sealed class CleanSettings {
    [Required, RegularExpression("^[a-z]+$"), ValueOnlyCheck]
    public string? Text { get; init; }

    [Range(1, 10)]
    public int Count { get; init; }

    [Required, MinLength(1)]
    public IReadOnlyList<string>? Entries { get; init; }
  }

  /// <summary>A custom check that builds its own result, with no member named.</summary>
  [AttributeUsage(AttributeTargets.Property)]
  private sealed class OwnResultCheckAttribute : ValidationAttribute {
    protected override ValidationResult? IsValid(object? value, ValidationContext validationContext) => new("The value is wrong.");
  }

  /// <summary>A check of a whole class, of the value alone: refused on a settings class however it builds its result.</summary>
  [AttributeUsage(AttributeTargets.Class)]
  private sealed class WholeClassCheckAttribute : ValidationAttribute {
    public override bool IsValid(object? value) => value is not null;
  }

  /// <summary>A custom check of the value alone, leaving the result to the base class.</summary>
  [AttributeUsage(AttributeTargets.Property)]
  private sealed class ValueOnlyCheckAttribute : ValidationAttribute {
    /// <summary>The one value it fails.</summary>
    public const string BROKEN = "broken";

    public override bool IsValid(object? value) => !string.Equals(value as string, BROKEN, StringComparison.Ordinal);
  }
}