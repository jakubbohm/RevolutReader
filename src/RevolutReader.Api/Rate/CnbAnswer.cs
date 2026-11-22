namespace RevolutReader.Api.Rate;

/// <summary>What one ask of the CNB came to (c017 design.md D6): the euro's rate, or why not.</summary>
public union CnbAnswer(KorunaRate, CnbFailed);

/// <summary>An ask that failed (D6); <paramref name="StatusCode"/> only for <see cref="CnbFailure.Status"/>.</summary>
public sealed record CnbFailed(CnbFailure Kind, int? StatusCode = null);

/// <summary>Why an ask failed (D6).</summary>
public enum CnbFailure {
  /// <summary>The 2 s limit ran out.</summary>
  NoAnswerInTime,

  /// <summary>A network error: DNS, refused, reset.</summary>
  Unreachable,

  /// <summary>Any status but 200 (with the code).</summary>
  Status,

  /// <summary>Not JSON, no <c>rates</c>, no <c>EUR</c> entry, a rate or amount that is not a positive number, a missing or malformed <c>validFor</c>.</summary>
  Unreadable,
}