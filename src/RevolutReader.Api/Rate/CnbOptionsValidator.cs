using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Rate;

/// <summary>
/// What the data annotations cannot check (c017 design.md D1; review of PR #95, finding 1). The CNB's address is an
/// absolute https address, or plain http only on this machine (a loopback host: the test fakes), the rule the bank's
/// address follows (<c>EnableBankingOptionsValidator</c>). A scheme-less value binds as a relative address, which the named
/// client would refuse only at the first ask, so every request that carries a rate would fail; another scheme or plain
/// http to another host is no address the client should ask. The message names the setting, never its value.
/// </summary>
public sealed class CnbOptionsValidator : IValidateOptions<CnbOptions> {
  private const string NOT_AN_API_ADDRESS =
    $"{nameof(CnbOptions)}.{nameof(CnbOptions.Address)} is not an address the CNB can be asked at: "
    + "expected an absolute https address (plain http only on this machine).";

  public ValidateOptionsResult Validate(string? name, CnbOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    return IsApiAddress(options.Address) ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(NOT_AN_API_ADDRESS);
  }

  /// <summary>Whether <paramref name="address"/> is absolute and https, or http to a loopback host (localhost, 127.0.0.0/8, ::1).</summary>
  private static bool IsApiAddress(Uri? address) =>
    address is { IsAbsoluteUri: true }
    && (address.Scheme == Uri.UriSchemeHttps || (address.Scheme == Uri.UriSchemeHttp && address.IsLoopback));
}