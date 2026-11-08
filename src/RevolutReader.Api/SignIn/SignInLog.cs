namespace RevolutReader.Api.SignIn;

/// <summary>
/// Sign-in's log lines (c007 design.md D3, D8), source-generated: never an email address, a token or an exception message.
/// </summary>
public static partial class SignInLog {
  /// <summary>
  /// A sign-in by an account that is not on the allowlist, or has no email address: logged once, at sign-in, with the
  /// account's pairwise subject, an id that means something only to this app, so repeated attempts can be grouped. The
  /// sign-in itself completes; its requests are refused one by one, without a warning each.
  /// </summary>
  [LoggerMessage(EventName = "SignInRefused", Level = LogLevel.Warning, Message = "Sign-in by an account that is not on the allowlist (subject {Subject}); its requests will be refused")]
  public static partial void SignInRefused(ILogger logger, string subject);
}