using System.Net;

namespace RevolutReader.Api.Bank;

/// <summary>
/// Who triggers a read (spec bank-reads, c004 design.md D2): a present user, whose address and browser go to the bank as
/// user headers, or unattended, with no user headers. No default: a default (empty) union throws in a switch.
/// </summary>
public union ReadTrigger(PresentUser, Unattended);

/// <summary>
/// The user's real values, checked when created (spec bank-reads § Who triggers a read; c006 design.md D1 g): an address
/// and a non-blank user agent. The address is already parsed (<see cref="Account.PresentUserFromRequest.Read"/> takes it
/// from the forwarded headers, C13).
/// </summary>
public sealed record PresentUser {
  public IPAddress IpAddress { get; }

  /// <summary>As given; cleaned only when the header is built (c006 design.md D5).</summary>
  public string UserAgent { get; }

  /// <exception cref="ArgumentNullException">No address.</exception>
  /// <exception cref="ArgumentException">A null, empty or whitespace user agent.</exception>
  public PresentUser(IPAddress ipAddress, string userAgent) {
    ArgumentNullException.ThrowIfNull(ipAddress);
    ArgumentException.ThrowIfNullOrWhiteSpace(userAgent);

    IpAddress = ipAddress;
    UserAgent = userAgent;
  }
}

/// <summary>A read nobody is waiting for (the background check): no user headers.</summary>
public sealed record Unattended;