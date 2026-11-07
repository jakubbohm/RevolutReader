using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>
/// What the data annotations cannot check (c004 design.md D6). The API address is an absolute http or https address
/// whose path ends in "/" (a bare host's path is "/"), so every request path is appended to it. The key parses as an
/// RSA private key in PEM form, PKCS#8 or PKCS#1; a public key fails too. Each message names the setting, never its
/// value or any part of it.
/// </summary>
public sealed class EnableBankingOptionsValidator : IValidateOptions<EnableBankingOptions> {
  private const string PKCS8_LABEL = "PRIVATE KEY";
  private const string PKCS1_LABEL = "RSA PRIVATE KEY";

  private const string NOT_AN_API_ADDRESS =
    $"{nameof(EnableBankingOptions)}.{nameof(EnableBankingOptions.ApiBaseUrl)} is not an address the requests can be sent to: "
    + "expected an absolute http or https address with no path, or a path ending in \"/\".";

  private const string NOT_AN_RSA_PRIVATE_KEY =
    $"{nameof(EnableBankingOptions)}.{nameof(EnableBankingOptions.PrivateKey)} is not an RSA private key in PEM form: "
    + $"expected exactly one unencrypted key, labelled \"{PKCS8_LABEL}\" (PKCS#8) or \"{PKCS1_LABEL}\" (PKCS#1).";

  public ValidateOptionsResult Validate(string? name, EnableBankingOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    List<string> failures = [];

    if (!IsApiAddress(options.ApiBaseUrl))
      failures.Add(NOT_AN_API_ADDRESS);

    if (!IsRsaPrivateKeyPem(options.PrivateKey))
      failures.Add(NOT_AN_RSA_PRIVATE_KEY);

    return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
  }

  /// <summary>
  /// Whether <paramref name="address"/> is absolute, http or https, and its path ends in "/". The client's requests are
  /// relative ("accounts/…"), and RFC 3986 resolution replaces everything after the base's last "/": against
  /// "https://host/eb" they would go to "https://host/accounts/…". A scheme-less value binds as a relative URI, which
  /// HttpClient would reject only at the first read.
  /// </summary>
  private static bool IsApiAddress(Uri? address) =>
    address is { IsAbsoluteUri: true }
    && (address.Scheme == Uri.UriSchemeHttps || address.Scheme == Uri.UriSchemeHttp)
    && address.AbsolutePath.EndsWith('/', StringComparison.Ordinal);

  /// <summary>
  /// Whether the BCL's PEM import finds exactly one RSA key in <paramref name="text"/>, and it is a private one. The import
  /// alone takes a public key too; it rejects several keys, so a private-key label means the key it took is private.
  /// </summary>
  private static bool IsRsaPrivateKeyPem(string? text) {
    if (string.IsNullOrEmpty(text) || !HasPrivateKeyLabel(text))
      return false;

    using RSA key = RSA.Create();
    try {
      key.ImportFromPem(text);

      return true;
    }
    catch (ArgumentException) {
      return false; // no key, several keys, or an encrypted one
    }
    catch (CryptographicException) {
      return false; // not an RSA key (e.g. an EC key under the PKCS#8 label), or a damaged one
    }
  }

  private static bool HasPrivateKeyLabel(ReadOnlySpan<char> text) {
    while (PemEncoding.TryFind(text, out PemFields block)) {
      if (text[block.Label] is PKCS8_LABEL or PKCS1_LABEL)
        return true;

      text = text[block.Location.End..];
    }

    return false;
  }
}