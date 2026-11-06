using RevolutReader.AcceptanceTests.Dsl;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Opens page addresses over HTTP (spec app-delivery, c003 design.md D6). <see cref="PageAnswer.TheApp"/> only when all
/// three hold: status 200, content type <c>text/html</c> (the media type is compared; a parameter such as
/// <c>charset</c> is allowed), and a body equal to <see cref="StandInPages.StartPage"/>.
/// <see cref="PageAnswer.SomethingElse"/> for any other answer.
/// </summary>
public sealed class PagesDriver {
  private readonly HttpClient _http;

  public PagesDriver(HttpClient http) => _http = http;

  /// <summary>Stub until the wiring of slice 5 (tasks.md 9.2).</summary>
  public Task<PageAnswer> GetPage(string path) => throw new NotImplementedException();
}