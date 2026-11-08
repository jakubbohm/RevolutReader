using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;

namespace RevolutReader.Api.Account;

/// <summary>Not yet (the review's #3, the user, 2026-11-08).</summary>
public enum BankProblemType {
  AccessExpired,
  RateLimited,
  Unavailable,
}

/// <summary>Not yet (the review's #3, the user, 2026-11-08).</summary>
public sealed class BankProblem : ProblemDetails {
  [JsonPropertyName("type")]
  public new required BankProblemType Type { get; init; }
}