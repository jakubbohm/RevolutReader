using System.Net;
using Microsoft.Extensions.Primitives;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>Who a bank read for a signed-in user's request is made for (roadmap C13): the present user behind the request.</summary>
public static class PresentUserFromRequest {
  /// <summary>
  /// The user whose address and browser go to the bank as user headers (ADR-0001). The address is the connection's client
  /// address as the forwarded headers left it, the visitor's and not the ingress's (c007 design.md D10). An IPv4 address in
  /// IPv6 form (<c>::ffff:203.0.113.7</c>, as a server listening on IPv6 reports an IPv4 visitor) becomes plain IPv4, so
  /// the bank gets the address the visitor has (c004 design.md D2); any other address, an IPv6 one too, is kept as it is.
  /// The browser name is the <c>User-Agent</c> header as ASP.NET reads it (sent on two lines: both values joined with a
  /// comma), kept as given: cleaning it to printable ASCII is <see cref="PsuHeaders"/>' job (c006 design.md D5).
  /// <see langword="null"/> without a client address or with a missing, empty or whitespace <c>User-Agent</c>, each line
  /// judged on its own (two blank lines read as <c>" , "</c>, which is not blank): the endpoint then answers
  /// <see cref="BankAnswers.NoPresentUser"/>'s 400 and never reads unattended in its place, which would count against the
  /// bank's 4 reads a day without the user (the user, 2026-11-08, roadmap C13; ADR-0001).
  /// </summary>
  public static PresentUser? Read(HttpContext context) {
    ArgumentNullException.ThrowIfNull(context);

    IPAddress? address = context.Connection.RemoteIpAddress;
    StringValues userAgent = context.Request.Headers.UserAgent;
    if (address is null || userAgent.All(string.IsNullOrWhiteSpace))
      return null;

    return new PresentUser(address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address, userAgent.ToString());
  }
}