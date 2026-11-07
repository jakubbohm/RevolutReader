using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>
/// What the data annotations cannot check (c004 design.md D6). The API address is an absolute https address (plain http
/// only on this machine) whose path ends in "/" (a bare host's path is "/") and that has no query or fragment, so every
/// request path is appended to it and nothing of it is lost. The key parses as an RSA private key in PEM form, PKCS#8
/// or PKCS#1; a public key fails too. Each message names the setting, never its value or any part of it.
/// </summary>
public sealed class EnableBankingOptionsValidator : IValidateOptions<EnableBankingOptions> {
  private const string PKCS8_LABEL = "PRIVATE KEY";
  private const string PKCS1_LABEL = "RSA PRIVATE KEY";

  private const string NOT_AN_API_ADDRESS =
    $"{nameof(EnableBankingOptions)}.{nameof(EnableBankingOptions.ApiBaseUrl)} is not an address the requests can be sent to: "
    + "expected an absolute https address (plain http only on this machine) with no path or a path ending in \"/\", "
    + "and no query or fragment.";

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
  /// Whether <paramref name="address"/> is absolute, https (or http to a loopback host: localhost, 127.0.0.0/8, ::1), its
  /// path ends in "/", and it has no query or fragment. Every request carries the signed token and, for a user's open or
  /// refresh, the user's PSU headers, so plain http is allowed only where nothing leaves this machine (the test fakes).
  /// The client's requests are relative ("accounts/…"), and RFC 3986 resolution replaces everything after the base's
  /// last "/" and drops its query and fragment: against "https://host/eb" they would go to "https://host/accounts/…",
  /// and against "https://host/eb/?tenant=x" to "https://host/eb/accounts/…" without the query. A scheme-less value
  /// binds as a relative URI, which HttpClient would reject only at the first read.
  /// </summary>
  private static bool IsApiAddress(Uri? address) =>
    address is { IsAbsoluteUri: true }
    && (address.Scheme == Uri.UriSchemeHttps || (address.Scheme == Uri.UriSchemeHttp && address.IsLoopback))
    && address.AbsolutePath.EndsWith('/', StringComparison.Ordinal)
    && address.Query.Length == 0
    && address.Fragment.Length == 0;

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