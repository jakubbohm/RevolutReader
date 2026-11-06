using System.Net;

namespace RevolutReader.Api.Bank;

/// <summary>
/// Who triggers a read (spec bank-reads, c004 design.md D2): a present user, whose address and browser go to the bank as
/// user headers, or unattended, with no user headers. No default: a default (empty) union throws in a switch.
/// </summary>
public union ReadTrigger(PresentUser, Unattended);

/// <summary>The user's real values. The address is already parsed (C7 takes it from the forwarded headers).</summary>
public sealed record PresentUser(IPAddress IpAddress, string UserAgent);

/// <summary>A read nobody is waiting for (the background check): no user headers.</summary>
public sealed record Unattended;