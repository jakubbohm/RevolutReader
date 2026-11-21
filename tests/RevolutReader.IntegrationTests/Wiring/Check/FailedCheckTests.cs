using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Check;

/// <summary>
/// A check that throws (c014 design.md D11, § Error model; spec api-errors): the endpoint answers C7a's 500 problem
/// description, as the exception handler writes one for an exception no endpoint catches (docs/conventions/README.md, the
/// case table's last row: the default <c>type</c>, the title <c>Internal Server Error</c>, and no members but <c>type</c>,
/// <c>title</c>, <c>status</c> and <c>traceId</c>, so nothing about the failure), and the failure is logged once, by the
/// queue (<c>CheckFailed</c>, D15): the exception handler, which would log it a second time, never sees it. The app copy is
/// <see cref="CheckEndpointApp"/>'s, with the check replaced by one that throws and every log line at Error kept; the
/// request is the Shortcut's, with the right key, a browser name and a documentation address (RFC 5737).
/// </summary>
public sealed class FailedCheckTests {
  /// <summary>Distinctive, so it cannot turn up in the answer by coincidence.</summary>
  private const string MARKER = "9a2c6e";

  /// <summary>The headers that name the present user (c013 design.md, D7).</summary>
  private const string USER_AGENT = "User-Agent";
  private const string X_FORWARDED_FOR = "X-Forwarded-For";

  private const string PROBLEM_JSON = "application/problem+json";

  /// <summary>The type ASP.NET Core gives a 500 of its own: RFC 9110's section for the status.</summary>
  private const string INTERNAL_SERVER_ERROR_TYPE = "https://tools.ietf.org/html/rfc9110#section-15.6.1";

  [Test]
  public async Task A_check_that_throws_answers_the_500_problem_description_and_is_logged_once_by_the_queue() {
    await using CheckEndpointApp app = new();
    using ErrorLines errors = new();
    await using WebApplicationFactory<Program> failingCheck = app.WithWebHostBuilder(builder => builder
      .ConfigureLogging(logging => logging.AddProvider(errors))
      .ConfigureTestServices(static services => services.AddScoped<IAccountCheck>(static _ => new ThrowingCheck())));
    using HttpClient phone = failingCheck.CreateClient();

    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(CheckEndpointApp.CHECK, UriKind.Relative));
    AddAsItIs(request, CheckEndpointApp.CHECK_KEY_HEADER, app.CheckKey);
    AddAsItIs(request, USER_AGENT, "BackgroundShortcutRunner/5114.0");
    AddAsItIs(request, X_FORWARDED_FOR, "203.0.113.7");

    using HttpResponseMessage response = await phone.SendAsync(request);
    string body = await response.Content.ReadAsStringAsync();

    using JsonDocument problem = JsonDocument.Parse(body);
    JsonElement answer = problem.RootElement;
    answer.ValueKind.ShouldBe(JsonValueKind.Object, body);
    answer.ShouldSatisfyAllConditions(
      () => response.StatusCode.ShouldBe(HttpStatusCode.InternalServerError),
      () => response.Content.Headers.ContentType?.MediaType.ShouldBe(PROBLEM_JSON),
      () => answer.EnumerateObject().Select(static member => member.Name).ShouldBe((string[])["type", "title", "status", "traceId"], ignoreOrder: true, customMessage: body),
      () => answer.GetProperty("status").GetInt32().ShouldBe(500),
      () => answer.GetProperty("title").GetString().ShouldBe("Internal Server Error"),
      () => answer.GetProperty("type").GetString().ShouldBe(INTERNAL_SERVER_ERROR_TYPE),
      () => body.ShouldNotContain(MARKER));

    ErrorLine line = errors.Lines.ShouldHaveSingleItem("one error line in the whole app: the queue's");
    line.ShouldSatisfyAllConditions(
      () => line.Category.ShouldBe(typeof(AccountCheckQueue).FullName),
      () => line.EventName.ShouldBe("CheckFailed"),
      () => line.Exception.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain(MARKER));
  }

  /// <summary>Adds the header unvalidated, so it goes out exactly as given.</summary>
  private static void AddAsItIs(HttpRequestMessage request, string name, string value) {
    if (!request.Headers.TryAddWithoutValidation(name, value))
      throw new InvalidOperationException($"The request header {name} could not be added.");
  }

  /// <summary>A check that fails as one whose storage fails does: it throws, with a made-up message holding the marker.</summary>
  private sealed class ThrowingCheck : IAccountCheck {
    public Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) =>
      Task.FromException<BankResult<CheckOutcome>>(new InvalidOperationException($"A made-up storage failure, {MARKER}."));
  }

  /// <summary>Every log line at Error or above, from any category: its category, its event's name and its exception.</summary>
  private sealed class ErrorLines : ILoggerProvider {
    private readonly Lock _lock = new();
    private readonly List<ErrorLine> _lines = [];

    /// <summary>The lines so far, in the order written.</summary>
    public IReadOnlyList<ErrorLine> Lines {
      get {
        lock (_lock)
          return [.. _lines];
      }
    }

    public ILogger CreateLogger(string categoryName) => new CategoryLogger(this, categoryName);

    private void Add(ErrorLine line) {
      lock (_lock)
        _lines.Add(line);
    }

    private sealed class CategoryLogger(ErrorLines lines, string category) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

      public bool IsEnabled(LogLevel logLevel) => logLevel is >= LogLevel.Error and not LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
        if (IsEnabled(logLevel))
          lines.Add(new ErrorLine(category, eventId.Name, exception));
      }
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }

  /// <summary>One line at Error or above.</summary>
  private sealed record ErrorLine(string Category, string? EventName, Exception? Exception);
}