using System.Security.Claims;

namespace RevolutReader.Api.SignIn;

/// <summary>
/// The account a request is recorded under in the request telemetry (roadmap C14; ADR-0009-application-telemetry, Decision
/// item 7): an allowed, signed-in user's email address, on the request's server activity only, never in a log line
/// (ADR-0004-account-allowlist, Decision item 7).
/// </summary>
public static class RequestAccount {
  /// <summary>
  /// OpenTelemetry's attribute for the signed-in user, which the Azure Monitor exporter writes to the request's
  /// authenticated user (the <c>UserAuthenticatedId</c> column of <c>AppRequests</c>; its <c>TelemetryItem</c> at 1.10.0).
  /// </summary>
  public const string TAG = "enduser.id";

  /// <summary>
  /// The email address to record for <paramref name="user"/>: the login's <c>email</c> claim when the allowlist holds it,
  /// as the login gives it; <see langword="null"/> for a request without a login, a login without an email address, and an
  /// account that is not on the allowlist.
  /// </summary>
  public static string? Of(ClaimsPrincipal user, Allowlist allowlist) => throw new NotImplementedException();
}