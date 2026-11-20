using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace RevolutReader.AcceptanceTests.Drivers;

/// <summary>
/// Every log entry of an app copy, whatever its category, as text: the message, each structured value, each scope and its
/// values, the exception. A test registers <see cref="Provider"/> in its app copy's container, so what reaches it has passed
/// the app copy's log level settings (<c>Logging:LogLevel</c>), and only this app copy's loggers write into it. Moved here
/// from <c>Conventions/BankTelemetryTests</c> when a second telemetry guard needed it (roadmap C14).
/// </summary>
public sealed class CapturedLogTexts {
  private readonly Lock _lock = new();
  private readonly List<(string Category, IReadOnlyList<string> Texts)> _entries = [];

  /// <summary>The texts of every entry.</summary>
  public IReadOnlyList<string> Texts() {
    lock (_lock)
      return [.. _entries.SelectMany(static entry => entry.Texts)];
  }

  /// <summary>The messages of the entries of this category, in the order written.</summary>
  public IReadOnlyList<string> MessagesOf(string category) {
    lock (_lock)
      return [.. _entries.Where(entry => entry.Category == category).Select(static entry => entry.Texts[0])];
  }

  /// <summary>A logger provider writing into this capture, scopes included; the app copy's container owns it.</summary>
  public ILoggerProvider Provider() => new CapturingLoggerProvider(this);

  /// <summary>One entry: its category, then its message first among its texts.</summary>
  private void Add(string category, IReadOnlyList<string> texts) {
    lock (_lock)
      _entries.Add((category, texts));
  }

  private sealed class CapturingLoggerProvider(CapturedLogTexts logs) : ILoggerProvider, ISupportExternalScope {
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this, categoryName);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    private void Capture<TState>(string category, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      List<string> texts = [formatter(state, exception)];

      AddValues(texts, state);

      if (exception is not null)
        texts.Add(exception.ToString());

      _scopes.ForEachScope(static (scope, list) => AddValues(list, scope), texts);

      logs.Add(category, texts);
    }

    private static void AddValues(List<string> texts, object? state) {
      if (state is null)
        return;

      texts.Add(state.ToString() ?? string.Empty);

      if (state is IEnumerable<KeyValuePair<string, object?>> values)
        texts.AddRange(values.Select(static pair => $"{pair.Key}={pair.Value}"));
    }

    private sealed class CapturingLogger(CapturingLoggerProvider provider, string category) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider._scopes.Push(state);

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        provider.Capture(category, state, exception, formatter);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}

/// <summary>
/// The in-memory exporter's collection, safe for concurrent adds: an app copy's tracer listens process-wide, so the
/// activities of other tests' app copies, running in parallel, arrive here too (with their own made-up values). A test
/// looks for values only it uses, for its own requests by an address only it uses (<see cref="RequestsTo"/>), or for a
/// value no app copy may export at all. Moved here from <c>Conventions/BankTelemetryTests</c> when a second telemetry guard
/// needed it (roadmap C14).
/// <para>
/// An activity arrives when it stops (the in-memory exporter runs on OpenTelemetry's simple processor), and the test
/// server stops a request's server activity only after the client has the response (Microsoft.AspNetCore.TestHost 11.0.0
/// completes the response, then ends the request, on another thread). So the server activity of a test's last request
/// may not be here yet when the test's call returns: a test that asserts on a server activity first waits for it with
/// <see cref="WaitForServerActivity"/> or <see cref="RequestsTo"/>.
/// </para>
/// </summary>
public sealed class ExportedActivityCollection : ICollection<Activity> {
  /// <summary>OpenTelemetry's attribute for a request's path, which the app's ASP.NET Core instrumentation puts on every server activity.</summary>
  private const string URL_PATH = "url.path";

  /// <summary>How long <see cref="WaitForServerActivity"/> waits at most, far longer than a request takes to end.</summary>
  private static readonly TimeSpan _waitAtMost = TimeSpan.FromSeconds(5);

  private readonly Lock _lock = new();
  private readonly List<Activity> _activities = [];

  /// <summary>Completes at the next <see cref="Add"/>, which puts a new one in its place.</summary>
  private TaskCompletionSource _nextAdd = NewSignal();

  public int Count {
    get {
      lock (_lock)
        return _activities.Count;
    }
  }

  public bool IsReadOnly => false;

  /// <summary>Every exported activity, as text: its names, status, tags, events and their tags.</summary>
  public IReadOnlyList<string> Texts() => [.. Snapshot().SelectMany(static activity => TextsOf(activity))];

  /// <summary>The value of <paramref name="tag"/> on every exported server activity (a request an app copy answered) that carries it.</summary>
  public IReadOnlyList<string> ServerTagValues(string tag) =>
    [.. Snapshot().Where(static activity => activity.Kind == ActivityKind.Server).Select(activity => activity.GetTagItem(tag)?.ToString()).OfType<string>()];

  /// <summary>
  /// The exported server activities of the requests to <paramref name="path"/>, once at least one has been exported (as
  /// <see cref="WaitForServerActivity"/> waits), or none after 5 s, in the order exported. With an address only the test
  /// uses (a made-up segment in it), they are the test's own requests: a test then asserts on them, whether a request
  /// carries a tag or not, and a request whose activity never arrives leaves the list empty instead of passing unseen.
  /// </summary>
  public async Task<IReadOnlyList<Activity>> RequestsTo(string path) {
    ArgumentException.ThrowIfNullOrEmpty(path);

    await WaitForServerActivity(activity => IsRequestTo(activity, path));

    return [.. Snapshot().Where(activity => activity.Kind == ActivityKind.Server && IsRequestTo(activity, path))];
  }

  /// <summary>
  /// Returns once an exported server activity matches <paramref name="match"/>, or after 5 s when none has: it looks again
  /// at every add, never on a timer. A miss is no failure here; the test's own assertion that follows reports it. A test
  /// asserting on one request's server activity, whether it carries a tag or not, waits here for that activity first
  /// (see the class).
  /// </summary>
  public async Task WaitForServerActivity(Func<Activity, bool> match) {
    ArgumentNullException.ThrowIfNull(match);

    using CancellationTokenSource waitAtMost = new(_waitAtMost);

    while (true) {
      Task nextAdd = NextAdd();

      if (Snapshot().Any(activity => activity.Kind == ActivityKind.Server && match(activity)) || waitAtMost.IsCancellationRequested)
        return;

      await nextAdd.WaitAsync(waitAtMost.Token).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
    }
  }

  public void Add(Activity item) {
    TaskCompletionSource added;

    lock (_lock) {
      _activities.Add(item);
      added = _nextAdd;
      _nextAdd = NewSignal();
    }

    added.SetResult();
  }

  public void Clear() {
    lock (_lock)
      _activities.Clear();
  }

  public bool Contains(Activity item) {
    lock (_lock)
      return _activities.Contains(item);
  }

  public void CopyTo(Activity[] array, int arrayIndex) {
    lock (_lock)
      _activities.CopyTo(array, arrayIndex);
  }

  public bool Remove(Activity item) {
    lock (_lock)
      return _activities.Remove(item);
  }

  public IEnumerator<Activity> GetEnumerator() => Snapshot().AsEnumerable().GetEnumerator();

  System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();

  private Activity[] Snapshot() {
    lock (_lock)
      return [.. _activities];
  }

  /// <summary>
  /// A task that completes at the next add. Taken before a look at the snapshot, so an add between the look and the wait
  /// still ends the wait.
  /// </summary>
  private Task NextAdd() {
    lock (_lock)
      return _nextAdd.Task;
  }

  /// <summary>A waiter resumes on the thread pool, not inside the exporter's add, which runs as the request ends.</summary>
  private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

  /// <summary>Whether <paramref name="activity"/>'s request path is <paramref name="path"/>.</summary>
  private static bool IsRequestTo(Activity activity, string path) => activity.GetTagItem(URL_PATH)?.ToString() == path;

  private static IEnumerable<string> TextsOf(Activity activity) {
    yield return activity.DisplayName;
    yield return activity.OperationName;
    yield return activity.StatusDescription ?? string.Empty;

    foreach (KeyValuePair<string, object?> tag in activity.TagObjects)
      yield return $"{tag.Key}={tag.Value}";

    foreach (ActivityEvent activityEvent in activity.Events) {
      yield return activityEvent.Name;

      foreach (KeyValuePair<string, object?> tag in activityEvent.Tags)
        yield return $"{tag.Key}={tag.Value}";
    }
  }
}