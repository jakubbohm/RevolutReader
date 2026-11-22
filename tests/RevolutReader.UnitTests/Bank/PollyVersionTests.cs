using System.Reflection;
using Polly;
using Polly.RateLimiting;
using Polly.Telemetry;
using Shouldly;

namespace RevolutReader.UnitTests.Bank;

/// <summary>
/// The Polly the bank client's retries run on (#97). Polly checks a strategy's options with DataAnnotations, and
/// <c>RangeAttribute(Type, string, string)</c>, which it puts on TimeSpan members, sets itself up lazily without a lock
/// (dotnet/runtime#110917): two pipelines built at the same time could fail that check at random. Polly 8.5.1 runs the
/// check under a lock (App-vNext/Polly#2412). Microsoft.Extensions.Http.Resilience accepts any Polly from 8.4.2 up, and
/// NuGet takes the lowest version a package accepts, so the three Polly packages are pinned in Directory.Packages.props;
/// without that pin the app falls back to 8.4.2.
/// </summary>
public sealed class PollyVersionTests {
  /// <summary>The first release whose options check is thread-safe.</summary>
  private static readonly Version _firstThreadSafeRelease = new(8, 5, 1);

  /// <param name="anyTypeOfThePackage">
  /// A public type of each Polly package the app runs: Polly.Core, which holds the options check, and Polly.Extensions and
  /// Polly.RateLimiting, which are released together with it and pinned with it.
  /// </param>
  [Test]
  [Arguments(typeof(ResiliencePipeline))]
  [Arguments(typeof(TelemetryOptions))]
  [Arguments(typeof(RateLimiterStrategyOptions))]
  public void The_app_runs_Polly_8_5_1_or_later_whose_options_check_is_thread_safe(Type anyTypeOfThePackage) {
    ArgumentNullException.ThrowIfNull(anyTypeOfThePackage);

    Assembly assembly = anyTypeOfThePackage.Assembly;
    string? package = assembly.GetName().Name;

    // Every Polly 8 release has the assembly version 8.0.0.0, and the file version adds a build number, so only the
    // informational version is the package's own: "8.4.2+<commit>".
    string? informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
    informationalVersion.ShouldNotBeNull($"{package} carries no informational version, so its package version cannot be read (#97)");

    // Semantic versioning: the build metadata after "+" does not count, and a prerelease such as 8.5.1-beta comes before 8.5.1.
    string version = informationalVersion.Split('+')[0];
    string[] releaseAndPrerelease = version.Split('-', 2);
    Version release = Version.Parse(releaseAndPrerelease[0]);
    bool isThreadSafe = release > _firstThreadSafeRelease || (release == _firstThreadSafeRelease && releaseAndPrerelease.Length == 1);

    isThreadSafe.ShouldBeTrue($"{package} {version} is loaded; {_firstThreadSafeRelease} or later is needed (#97)");
  }
}