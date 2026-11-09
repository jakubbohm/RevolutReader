using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The Azure SDK's own log lines under the app's log levels from its <c>appsettings.json</c> (c010 design.md D11): Aspire's
/// tables client forwards every event source of the SDK (<c>Azure-*</c>) to the app's logging, each under its source's name
/// with dots for dashes, so <c>Azure-Identity</c> as <c>Azure.Identity</c>, and at Information for every table request,
/// its answer and every token the app's managed identity gets. Those lines go, or every transactions request would add
/// lines to Application Insights; the SDK's warnings stay. Each test writes a made-up line at each level straight into the
/// app's logging under the category, as the forwarder writes it, and looks at what a logger behind it receives.
/// </summary>
public sealed class AzureSdkLogTests {
  /// <summary>The app's own settings file, which the build copies next to the tests from the API project.</summary>
  private const string APP_SETTINGS = "appsettings.json";

  /// <summary>The settings section of the app's log levels.</summary>
  private const string LOGGING = "Logging";

  /// <param name="category">A category the forwarder writes under: the SDK's core, its sign-in library, the tables client.</param>
  [Test]
  [Arguments("Azure.Core")]
  [Arguments("Azure.Identity")]
  [Arguments("Azure.Data.Tables")]
  public void The_Azure_SDKs_information_lines_are_dropped_and_its_warnings_kept(string category) {
    using LevelsReceived received = new();
    using ServiceProvider services = AppLogging(received);
    ILogger logger = services.GetRequiredService<ILoggerFactory>().CreateLogger(category);

    logger.Log(LogLevel.Information, default, "A made-up information line.", null, static (text, _) => text);
    logger.Log(LogLevel.Warning, default, "A made-up warning.", null, static (text, _) => text);

    IReadOnlyList<LogLevel> levels = received.Levels;

    levels.ShouldSatisfyAllConditions(
      () => levels.ShouldNotContain(LogLevel.Information, "the SDK's Information line is dropped"),
      () => levels.ShouldContain(LogLevel.Warning, "the SDK's warning stays"));
  }

  /// <summary>The app's logging with the app's log levels, as the host applies them from its "Logging" section.</summary>
  private static ServiceProvider AppLogging(LevelsReceived received) {
    IConfiguration configuration = new ConfigurationBuilder()
      .AddJsonFile(Path.Combine(AppContext.BaseDirectory, APP_SETTINGS), optional: false)
      .Build();

    ServiceCollection services = new();

    services.AddLogging(logging => logging.AddConfiguration(configuration.GetSection(LOGGING)));
    services.AddSingleton<ILoggerProvider>(received);

    return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
  }

  /// <summary>A logger provider that notes the level of every line the app's log levels let through to it.</summary>
  private sealed class LevelsReceived : ILoggerProvider {
    private readonly ConcurrentQueue<LogLevel> _levels = new();

    /// <summary>The levels of the lines received so far, in the order they were written.</summary>
    public IReadOnlyList<LogLevel> Levels => [.. _levels];

    public ILogger CreateLogger(string categoryName) => new NotingLogger(_levels);

    private sealed class NotingLogger(ConcurrentQueue<LogLevel> levels) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        levels.Enqueue(logLevel);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}