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
/// A caller that stops waiting (c014 design.md D8, D16): the endpoint waits for the check on the caller's own token only,
/// so the caller's leaving ends its request at once, with nothing logged at Error, by the endpoint or by the exception
/// handler (a caller that leaves is no failure of the app's); the check itself goes on. The app copy is
/// <see cref="CheckEndpointApp"/>'s, with the check replaced by one that runs until the test releases it, every log line at
/// Error kept, and the request's end marked by a middleware outside the whole pipeline. The request is the Shortcut's, with
/// the right key, a browser name and a documentation address (RFC 5737).
/// </summary>
public sealed class LeavingCallerTests {
  /// <summary>How long the test waits on the real clock for something that must happen by itself: far longer than it takes.</summary>
  private static readonly TimeSpan _within = TimeSpan.FromSeconds(10);

  /// <summary>The headers that name the present user (c013 design.md, D7).</summary>
  private const string USER_AGENT = "User-Agent";
  private const string X_FORWARDED_FOR = "X-Forwarded-For";

  [Test]
  public async Task A_caller_that_stops_waiting_ends_its_request_at_once_with_no_error_line_and_the_check_goes_on() {
    await using CheckEndpointApp app = new();
    using ErrorLines errors = new();
    HeldCheck check = new();
    RequestEnds requests = new();
    await using WebApplicationFactory<Program> heldCheck = app.WithWebHostBuilder(builder => builder
      .ConfigureLogging(logging => logging.AddProvider(errors))
      .ConfigureTestServices(services => services
        .AddScoped<IAccountCheck>(_ => check)
        .AddSingleton<IStartupFilter>(requests)));
    using HttpClient phone = heldCheck.CreateClient();
    using CancellationTokenSource callerGivesUp = new();

    using HttpRequestMessage request = new(HttpMethod.Post, new Uri(CheckEndpointApp.CHECK, UriKind.Relative));
    AddAsItIs(request, CheckEndpointApp.CHECK_KEY_HEADER, app.CheckKey);
    AddAsItIs(request, USER_AGENT, "BackgroundShortcutRunner/5114.0");
    AddAsItIs(request, X_FORWARDED_FOR, "203.0.113.7");

    try {
      bool callerStoppedWaiting = await StopsWaitingOnceTheCheckRuns(phone, request, check, callerGivesUp);
      await requests.CheckEnded.WaitAsync(_within);
      bool checkEndedWithTheRequest = check.Ended.IsCompleted;
      check.Release();
      await check.Ended.WaitAsync(_within);

      errors.Lines.ShouldSatisfyAllConditions(
        () => callerStoppedWaiting.ShouldBeTrue("the caller's call ends in its own cancellation"),
        () => checkEndedWithTheRequest.ShouldBeFalse("the request ended while the check still ran: the endpoint waits on the caller's token only"),
        () => check.TokenCancelled.ShouldBeFalse("the check runs on the app's token, never the caller's"),
        () => errors.Lines.ShouldBeEmpty("no line at Error: a caller that leaves is no failure"));
    }
    finally {
      // A check still held would keep its request, and so the app copy's disposal, from ending: a failure ends in time.
      check.Release();
    }
  }

  /// <summary>
  /// Sends <paramref name="request"/> from <paramref name="phone"/> on <paramref name="callerGivesUp"/>'s token, waits until
  /// <paramref name="check"/> has started, then cancels the token: whether the call ended in that cancellation, rather
  /// than with an answer. The in-process server ends the call only once the request has ended, so a request that waits
  /// for the held check fails the wait, bounded, rather than hanging.
  /// </summary>
  private static async Task<bool> StopsWaitingOnceTheCheckRuns(HttpClient phone, HttpRequestMessage request, HeldCheck check, CancellationTokenSource callerGivesUp) {
    Task<HttpResponseMessage> call = phone.SendAsync(request, callerGivesUp.Token);
    await check.Started.WaitAsync(_within);
    await callerGivesUp.CancelAsync();

    try {
      using HttpResponseMessage answered = await call.WaitAsync(_within);

      return false;
    }
    catch (OperationCanceledException) when (callerGivesUp.IsCancellationRequested) {
      return true;
    }
  }

  /// <summary>Adds the header unvalidated, so it goes out exactly as given.</summary>
  private static void AddAsItIs(HttpRequestMessage request, string name, string value) {
    if (!request.Headers.TryAddWithoutValidation(name, value))
      throw new InvalidOperationException($"The request header {name} could not be added.");
  }

  /// <summary>A check that runs until the test releases it, or until its token is cancelled; it tells when it started and when it ended.</summary>
  private sealed class HeldCheck : IAccountCheck {
    private readonly TaskCompletionSource _started = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _released = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource _ended = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Ends once the check has started.</summary>
    public Task Started => _started.Task;

    /// <summary>Ends once the check has ended, however.</summary>
    public Task Ended => _ended.Task;

    /// <summary>Whether the token the check runs on was cancelled by the time it ended.</summary>
    public bool TokenCancelled { get; private set; }

    /// <summary>Lets the check end, with nothing changed.</summary>
    public void Release() => _released.TrySetResult();

    public async Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
      try {
        _ = _started.TrySetResult();
        await _released.Task.WaitAsync(cancellationToken);

        return new CheckOutcome(Changed: false);
      }
      finally {
        TokenCancelled = cancellationToken.IsCancellationRequested;
        _ = _ended.TrySetResult();
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

  /// <summary>Every log line at Error or above, from any category: its category and its event's name.</summary>
  private sealed class ErrorLines : ILoggerProvider {
    private readonly Lock _lock = new();
    private readonly List<string> _lines = [];

    /// <summary>The lines so far, in the order written, as category and event.</summary>
    public IReadOnlyList<string> Lines {
      get {
        lock (_lock)
          return [.. _lines];
      }
    }

    public ILogger CreateLogger(string categoryName) => new CategoryLogger(this, categoryName);

    private void Add(string line) {
      lock (_lock)
        _lines.Add(line);
    }

    private sealed class CategoryLogger(ErrorLines lines, string category) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

      public bool IsEnabled(LogLevel logLevel) => logLevel is >= LogLevel.Error and not LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
        if (IsEnabled(logLevel))
          lines.Add($"{category} {eventId.Name} {exception?.GetType().Name}");
      }
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}