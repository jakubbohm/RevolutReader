using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Push;

/// <summary>
/// What the data annotations cannot check (c011 design.md D5, D9): the VAPID pair, the message key's length, Subject an
/// https origin, every known push service a valid pattern. Messages name the setting, never a value.
/// </summary>
public sealed class PushOptionsValidator : IValidateOptions<PushOptions> {
  public ValidateOptionsResult Validate(string? name, PushOptions options) => throw new NotImplementedException();
}