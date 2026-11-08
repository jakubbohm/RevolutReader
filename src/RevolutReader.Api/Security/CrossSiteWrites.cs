namespace RevolutReader.Api.Security;

/// <summary>The rule against writes from other sites (D4), pure, so every row of its table is a unit test.</summary>
public static class CrossSiteWrites {
  public static bool IsAllowed(string method, PathString path, string? secFetchSite, string? origin, string requestOrigin) => throw new NotImplementedException();
}