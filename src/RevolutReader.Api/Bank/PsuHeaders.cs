namespace RevolutReader.Api.Bank;

/// <summary>The user headers a read sends to the bank (c004 design.md D2): a fixed set, decided by who triggers the read.</summary>
public static class PsuHeaders {
  /// <summary>Psu-Ip-Address and Psu-User-Agent for a present user; none for an unattended read.</summary>
  public static IReadOnlyList<KeyValuePair<string, string>> For(ReadTrigger trigger) => throw new NotImplementedException();
}