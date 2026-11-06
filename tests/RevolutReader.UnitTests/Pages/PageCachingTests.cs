using Microsoft.AspNetCore.Http;
using RevolutReader.Api.Pages;
using Shouldly;

namespace RevolutReader.UnitTests.Pages;

/// <summary>
/// The caching rule for the app's files (c003 design.md D5): Vite's hashed files under <c>/assets/</c> never change
/// under their name, so the browser keeps them for a year; everything else keeps its name across versions, so the
/// browser asks the server first, and a new version shows on the next open (spec app-delivery).
/// </summary>
public sealed class PageCachingTests {
  private const string KEPT_FOR_A_YEAR = "public, max-age=31536000, immutable";
  private const string CHECKED_WITH_THE_SERVER_FIRST = "no-cache";

  [Test]
  public void Files_under_assets_are_kept_for_a_year_without_asking_again() {
    PageCaching.CacheControlFor(new PathString("/assets/index-C4MmCVHq.js")).ShouldBe(KEPT_FOR_A_YEAR);
    PageCaching.CacheControlFor(new PathString("/assets/index-BxQ2kL9a.css")).ShouldBe(KEPT_FOR_A_YEAR);
  }

  [Test]
  public void The_start_page_is_always_checked_with_the_server_first() {
    PageCaching.CacheControlFor(new PathString("/")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
    PageCaching.CacheControlFor(new PathString("/index.html")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
    PageCaching.CacheControlFor(new PathString("/no-such-page")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
  }

  [Test]
  public void The_service_worker_is_always_checked_with_the_server_first() =>
    PageCaching.CacheControlFor(new PathString("/sw.js")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);

  [Test]
  public void Every_other_file_is_checked_with_the_server_first() {
    PageCaching.CacheControlFor(new PathString("/manifest.webmanifest")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
    PageCaching.CacheControlFor(new PathString("/app-icon.svg")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
    PageCaching.CacheControlFor(new PathString("/icon-192.png")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
    PageCaching.CacheControlFor(new PathString("/launch/apple-splash-portrait-light-1170x2532.png")).ShouldBe(CHECKED_WITH_THE_SERVER_FIRST);
  }
}