using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
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

  /// <summary>How long the test waits on the real clock for something that must happen by itself: far longer than it takes.</summary>
  private static readonly TimeSpan _within = TimeSpan.FromSeconds(10);

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

  /// <summary>
  /// A check that fails while its caller is leaving (review finding 3 on PR #88): the check cancels the caller's request
  /// (the in-process server then aborts it, <c>RequestAborted</c>) and only then fails, with its answer already faulted when
  /// the endpoint looks at it. The failure is still logged once, by the queue (D11, D15): one line at Error in the whole app,
  /// <c>CheckFailed</c>, and none from the exception handler for it. The test waits until the request has gone back
  /// through the whole pipeline before it reads the lines; the caller itself sees only its own cancellation. That the
  /// request had been aborted when the check failed is checked too, so the test cannot pass by missing the moment.
  /// </summary>
  [Test]
  public async Task A_check_that_fails_while_its_caller_leaves_is_logged_once_by_the_queue() {
    await using CheckEndpointApp app = new();
    using ErrorLines errors = new();
    using CancellationTokenSource callerLeaves = new();
    RequestEnds requests = new();
    LeavingCallersCheck check = new(callerLeaves);
    await using WebApplicationFactory<Program> failingCheck = app.WithWebHostBuilder(builder => builder
      .ConfigureLogging(logging => logging.AddProvider(errors))
      .ConfigureTestServices(services => services
        .AddHttpContextAccessor()
        .AddScoped<IAccountCheck>(provider => check.For(provider.GetRequiredService<IHttpContextAccessor>()))
        .AddSingleton<IStartupFilter>(requests)));
    using HttpClient phone = failingCheck.CreateClient();

    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(CheckEndpointApp.CHECK, UriKind.Relative));
    AddAsItIs(request, CheckEndpointApp.CHECK_KEY_HEADER, app.CheckKey);
    AddAsItIs(request, USER_AGENT, "BackgroundShortcutRunner/5114.0");
    AddAsItIs(request, X_FORWARDED_FOR, "203.0.113.7");

    bool callerLeft = await EndsInItsCancellation(phone.SendAsync(request, callerLeaves.Token), callerLeaves);
    await requests.CheckEnded.WaitAsync(_within);

    errors.Lines.ShouldSatisfyAllConditions(
      () => callerLeft.ShouldBeTrue("the caller's call ends in its own cancellation"),
      () => check.RequestAbortedWhenItFailed.ShouldBe(true, "the request had been aborted when the check failed: the moment the finding names"),
      () => errors.Lines.Select(static line => $"{line.Category} {line.EventName} {line.Exception?.GetType().Name}")
        .ShouldBe([$"{typeof(AccountCheckQueue).FullName} CheckFailed {nameof(InvalidOperationException)}"], "one line at Error in the whole app: the queue's, and none from the exception handler"));
  }

  /// <summary>Whether <paramref name="call"/> ends in the cancellation of <paramref name="callerLeaves"/>, rather than with an answer; bounded.</summary>
  private static async Task<bool> EndsInItsCancellation(Task<HttpResponseMessage> call, CancellationTokenSource callerLeaves) {
    try {
      using HttpResponseMessage answered = await call.WaitAsync(_within);

      return false;
    }
    catch (OperationCanceledException) when (callerLeaves.IsCancellationRequested) {
      return true;
    }
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

  /// <summary>
  /// The check of <see cref="A_check_that_fails_while_its_caller_leaves_is_logged_once_by_the_queue"/>: when it runs, it
  /// cancels the caller's request through <paramref name="callerLeaves"/>, waits on this thread, bounded, until the server
  /// has aborted the request (<c>RequestAborted</c>, read through <see cref="IHttpContextAccessor"/>: the first check of a
  /// queue starts on the request's own path), notes whether it had, and fails, its task already faulted when it returns.
  /// </summary>
  private sealed class LeavingCallersCheck(CancellationTokenSource callerLeaves) {
    /// <summary>Whether the request had been aborted when the check failed; <see langword="null"/> before it ran.</summary>
    public bool? RequestAbortedWhenItFailed { get; private set; }

    /// <summary>What cancels the caller's request.</summary>
    private CancellationTokenSource CallerLeaves => callerLeaves;

    /// <summary>The check, as one scope resolves it, reading the request through <paramref name="requests"/>.</summary>
    public IAccountCheck For(IHttpContextAccessor requests) => new Scoped(this, requests);

    private sealed class Scoped(LeavingCallersCheck owner, IHttpContextAccessor requests) : IAccountCheck {
      public Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
        CancellationToken aborted = requests.HttpContext?.RequestAborted ?? throw new InvalidOperationException("The check ran outside its request.");

        _ = owner.CallerLeaves.CancelAsync();

        if (!aborted.IsCancellationRequested)
          _ = aborted.WaitHandle.WaitOne(_within);

        owner.RequestAbortedWhenItFailed = aborted.IsCancellationRequested;

        return Task.FromException<BankResult<CheckOutcome>>(new InvalidOperationException($"A made-up storage failure as the caller leaves, {MARKER}."));
      }
    }
  }

  /// <summary>A middleware outside the whole pipeline that marks when a request to the check endpoint has ended, however it ended.</summary>
  private sealed class RequestEnds : IStartupFilter {
    private readonly TaskCompletionSource _checkEnded = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Ends once a request to the check endpoint has gone back through the whole pipeline.</summary>
    public Task CheckEnded => _checkEnded.Task;

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app => {
      app.Use(async (HttpContext context, RequestDelegate inner) => {
        try {
          await inner(context);
        }
        finally {
          if (context.Request.Path == CheckEndpointApp.CHECK)
            _ = _checkEnded.TrySetResult();
        }
      });
      next(app);
    };
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