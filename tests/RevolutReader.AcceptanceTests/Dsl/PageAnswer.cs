namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What a visitor got when opening a page address (spec app-delivery). <see cref="SomethingElse"/> is the default
/// value, so an unset answer never reads as the app's page.
/// </summary>
public enum PageAnswer {
  SomethingElse,
  TheApp,
}