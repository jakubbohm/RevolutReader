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
/// looks for values only it uses, or for a value no app copy may export at all. Moved here from
/// <c>Conventions/BankTelemetryTests</c> when a second telemetry guard needed it (roadmap C14).
/// </summary>
public sealed class ExportedActivityCollection : ICollection<Activity> {
  private readonly Lock _lock = new();
  private readonly List<Activity> _activities = [];

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

  public void Add(Activity item) {
    lock (_lock)
      _activities.Add(item);
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