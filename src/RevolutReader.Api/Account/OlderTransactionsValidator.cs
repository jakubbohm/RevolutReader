using FastEndpoints;
using FluentValidation;

namespace RevolutReader.Api.Account;

/// <summary>
/// <c>before</c> is required (c010 design.md D10). FastEndpoints answers a value it cannot read as a date with 400 by
/// itself, but binds a missing one as the default date, so this rule makes that a 400 too, with a problem description
/// (spec api-errors). The default date stands for a missing one: nothing can be kept before it anyway.
/// </summary>
public sealed class OlderTransactionsValidator : Validator<OlderTransactionsRequest> {
  public OlderTransactionsValidator() =>
    RuleFor(static request => request.Before).NotEmpty().WithMessage("before is required: a calendar date, as yyyy-MM-dd.");
}