using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>Who a bank read for a signed-in user's request is made for (roadmap C13): the present user behind the request.</summary>
public static class PresentUserFromRequest {
  /// <summary>
  /// The client address as the forwarded headers left it (c007 design.md D10), an IPv4 address in IPv6 form as plain IPv4
  /// (c004 design.md D2), and the <c>User-Agent</c> header as ASP.NET reads it, kept as given (c006 design.md D5);
  /// <see langword="null"/> without a client address or with a missing, empty or whitespace <c>User-Agent</c>.
  /// </summary>
  public static PresentUser? Read(HttpContext context) => throw new NotImplementedException();
}