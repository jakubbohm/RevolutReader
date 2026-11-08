namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// An account as the fake Microsoft's ID token names it (c007 design.md D6): its name and email address, and the
/// directory that issued it, as the token's issuer (<c>iss</c>) and tenant (<c>tid</c>).
/// </summary>
public sealed record IdentityAtMicrosoft(string Name, string Email, string Issuer, string TenantId) {
  /// <summary>A made-up work or school directory (D6), recognisably not a real tenant.</summary>
  public const string WORK_OR_SCHOOL_TENANT = "c0070000-0000-4000-8000-000000000001";

  /// <summary>A personal Microsoft account: issued by the personal-account service, the one issuer the app accepts (D3).</summary>
  public static IdentityAtMicrosoft PersonalAccount(string name, string email) =>
    new(name, email, FakeMicrosoft.PERSONAL_ACCOUNTS_ISSUER, FakeMicrosoft.PERSONAL_ACCOUNTS_TENANT);

  /// <summary>An account issued by a work or school directory (<see cref="WORK_OR_SCHOOL_TENANT"/>), in the issuer format Microsoft uses for every tenant.</summary>
  public static IdentityAtMicrosoft WorkOrSchoolAccount(string name, string email) =>
    new(name, email, $"https://login.microsoftonline.com/{WORK_OR_SCHOOL_TENANT}/v2.0", WORK_OR_SCHOOL_TENANT);
}