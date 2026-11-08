namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Where the visitor ended up when Microsoft sent them back (spec sign-in): on the app's start page or not. The driver
/// follows the app's answer (<see cref="Drivers.SignInDriver.ReturnFromMicrosoft"/>).
/// </summary>
public sealed record Landing(bool OnStartPage) {
  /// <summary>On the app's start page.</summary>
  public static Landing StartPage { get; } = new(true);

  /// <summary>Anywhere else, or nowhere: the default value of the flag, so an unset landing never reads as the start page.</summary>
  public static Landing Elsewhere { get; } = new(false);
}