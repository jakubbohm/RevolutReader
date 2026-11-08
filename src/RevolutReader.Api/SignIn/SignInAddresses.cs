namespace RevolutReader.Api.SignIn;

/// <summary>
/// Sign-in's fixed addresses, all under <c>/api/auth/</c> (c007 design.md D2). The return address is registered at
/// Microsoft, so changing one is a change to the Entra registration too.
/// </summary>
public static class SignInAddresses {
  /// <summary>Starts a sign-in: an anonymous endpoint that sends the visitor to Microsoft.</summary>
  public const string LOGIN = "/api/auth/login";

  /// <summary>Microsoft's return (<c>form_post</c>): the OpenID Connect handler's <c>CallbackPath</c>, middleware rather than an endpoint.</summary>
  public const string CALLBACK = "/api/auth/signin-oidc";

  /// <summary>Signs out of the app's own login only: an anonymous endpoint.</summary>
  public const string LOGOUT = "/api/auth/logout";
}