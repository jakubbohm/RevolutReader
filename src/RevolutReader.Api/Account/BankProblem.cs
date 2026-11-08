using System.ComponentModel;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace RevolutReader.Api.Account;

/// <summary>
/// The bank problems' <c>type</c>s, which the client compares as exact strings (the case → status table in
/// docs/conventions/README.md § Backend code): each member is written as its type, so the API description lists exactly
/// these three values.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<BankProblemType>))]
public enum BankProblemType {
  /// <summary>503: the bank access expired, and only the owner can renew it.</summary>
  [JsonStringEnumMemberName(BankProblem.ACCESS_EXPIRED_TYPE)]
  AccessExpired,

  /// <summary>429: the bank's request limit is reached.</summary>
  [JsonStringEnumMemberName(BankProblem.RATE_LIMITED_TYPE)]
  RateLimited,

  /// <summary>503: the bank's own trouble, no answer in time, or no connection.</summary>
  [JsonStringEnumMemberName(BankProblem.BANK_UNAVAILABLE_TYPE)]
  Unavailable,
}

/// <summary>
/// The bank problems' shape in the API description (the user, 2026-11-08, roadmap C13): ASP.NET's problem description
/// whose <c>type</c> is always there and can only be one of <see cref="BankProblemType"/>'s three. So the generated client
/// types name them, and a type renamed on one side only fails the frontend's type check once an endpoint declares this.
/// Never built by the app: <see cref="BankAnswers"/> writes the answers with these same types, as
/// <see cref="SignIn.RefusedProblem"/> describes the 403 the problem details service writes.
/// </summary>
[Description("A problem description of one of the bank's expected failures, named by its type")]
public sealed class BankProblem : ProblemDetails {
  internal const string ACCESS_EXPIRED_TYPE = "/problems/bank-access-expired";
  internal const string RATE_LIMITED_TYPE = "/problems/bank-rate-limited";
  internal const string BANK_UNAVAILABLE_TYPE = "/problems/bank-unavailable";

  [Description("Which of the bank's expected failures this is")]
  [JsonPropertyName("type")]
  public new required BankProblemType Type { get; init; }
}