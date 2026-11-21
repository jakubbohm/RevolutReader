using FastEndpoints;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Check;

/// <summary>
/// <c>POST /api/account/check</c> (spec account-check, c014 design.md D6): the account check the owner's iPhone Shortcut
/// calls, for anyone holding the check key, a key of its own, never the message key. Anonymous, on the checked list of
/// anonymous endpoints, and kept out of the API description; it binds nothing (a body is ignored), so nothing is read
/// before the key is checked.
/// <list type="bullet">
/// <item>The key first (<see cref="MessageKeyCheck"/> on <see cref="KEY_HEADER"/> against
/// <see cref="AccountCheckOptions.Key"/>): a missing, repeated or wrong key answers a 404 with no body, which
/// <c>UseStatusCodePages</c> fills in exactly as for an unknown <c>/api</c> address, so nothing is read at the bank.</item>
/// <item>Past the key, nothing is built yet: the present user's check (tasks.md 5.1) and the check itself with its answer
/// (tasks.md 10.2) come with their slices.</item>
/// </list>
/// The Shortcut's request carries neither <c>Sec-Fetch-Site</c> nor <c>Origin</c>, so the cross-site rule lets it through.
/// </summary>
public sealed class AccountCheckEndpoint(IOptions<AccountCheckOptions> options) : EndpointWithoutRequest {
  /// <summary>The request header the check key travels in (D6).</summary>
  public const string KEY_HEADER = "X-Check-Key";

  public override void Configure() {
    Post("/api/account/check");
    AllowAnonymous();
    Description(static endpoint => endpoint.ExcludeFromDescription());
  }

  public override async Task HandleAsync(CancellationToken ct) {
    if (!MessageKeyCheck.Matches(HttpContext.Request.Headers[KEY_HEADER], options.Value.Key)) {
      await Send.ResultAsync(TypedResults.NotFound());

      return;
    }

    throw new NotImplementedException("The account check past its key comes with tasks.md 5.1 and 10.2.");
  }
}