namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// Where starting a sign-in sent the visitor (spec sign-in, c007 design.md D6): whether to Microsoft's sign-in, the
/// address Microsoft is asked to return to, and whether Microsoft is asked to show its account picker. The driver reads
/// them from the app's answer (<see cref="Drivers.SignInDriver.StartSignIn"/>); <see cref="ReturnAddress"/> is
/// <see langword="null"/> when the visitor was not sent to Microsoft.
/// </summary>
public sealed record SignInStart(bool SentToMicrosoft, Uri? ReturnAddress, bool AccountPickerAsked);