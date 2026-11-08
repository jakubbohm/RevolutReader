using System.Globalization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using RevolutReader.Api.Bank;

namespace RevolutReader.IntegrationTests.Wiring.EnableBanking;

/// <summary>
/// A logger provider that keeps every line the bank client writes and, apart from them, every line of the resilience
/// library behind its retries (c008 design.md D9); nothing else the wiring logs gets in the way. Each line keeps its level,
/// its text as formatted, and its structured values by name. The logging's own filter runs first, so a line the app's
/// configured levels drop never arrives here.
/// </summary>
public sealed class CapturedLogLines : ILoggerProvider {
  /// <summary>The category the resilience library (Polly) logs under.</summary>
  private const string LIBRARY_CATEGORY = "Polly";

  private static readonly string _clientCategory = typeof(EnableBankingClient).FullName!;

  private readonly Lock _lock = new();
  private readonly List<LogLine> _lines = [];
  private readonly List<LogLine> _libraryLines = [];

  /// <summary>The client's lines so far, in the order they were written.</summary>
  public IReadOnlyList<LogLine> Lines {
    get {
      lock (_lock)
        return [.. _lines];
    }
  }

  /// <summary>The resilience library's lines so far, in the order they were written.</summary>
  public IReadOnlyList<LogLine> LibraryLines {
    get {
      lock (_lock)
        return [.. _libraryLines];
    }
  }

  public ILogger CreateLogger(string categoryName) => categoryName switch {
    _ when string.Equals(categoryName, _clientCategory, StringComparison.Ordinal) => new CapturingLogger(line => Add(_lines, line)),
    LIBRARY_CATEGORY => new CapturingLogger(line => Add(_libraryLines, line)),
    _ => NullLogger.Instance,
  };

  private void Add(List<LogLine> lines, LogLine line) {
    lock (_lock)
      lines.Add(line);
  }

  private sealed class CapturingLogger(Action<LogLine> add) : ILogger {
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      ArgumentNullException.ThrowIfNull(formatter);

      Dictionary<string, string?> values = new(StringComparer.Ordinal);

      if (state is IEnumerable<KeyValuePair<string, object?>> pairs) {
        foreach ((string name, object? value) in pairs)
          values[name] = Convert.ToString(value, CultureInfo.InvariantCulture);
      }

      add(new LogLine(logLevel, formatter(state, exception), values));
    }
  }

  #region IDisposable

  public void Dispose() {
  }

  #endregion
}

/// <summary>One line the bank client, or the resilience library, wrote.</summary>
/// <param name="Level">Its level.</param>
/// <param name="Text">Its text, as formatted.</param>
/// <param name="Values">The structured values by placeholder name, such as <c>ErrorCode</c>, each as invariant text.</param>
public sealed record LogLine(LogLevel Level, string Text, IReadOnlyDictionary<string, string?> Values) {
  /// <summary>The line's text and every structured value, for checks that something appears nowhere in it.</summary>
  public IEnumerable<string> Texts() => [Text, .. Values.Values.OfType<string>()];
}