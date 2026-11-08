using FastEndpoints;

namespace RevolutReader.Api.SignIn;

/// <summary>What starting a sign-in may ask for (c007 design.md D2): the query <c>anotherAccount=true</c>.</summary>
public sealed record LoginRequest {
  /// <summary>
  /// "Zkusit jiný účet": <see langword="true"/> asks Microsoft for its account picker, because after the app's own sign-out
  /// Microsoft would otherwise sign the same account in again without asking. Optional, so nullable: missing or
  /// <see langword="false"/> asks for nothing. Its API description is set in <see cref="LoginEndpoint"/>.
  /// </summary>
  [QueryParam]
  public bool? AnotherAccount { get; init; }
}