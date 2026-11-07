using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The key parses as an RSA private key in PEM form, PKCS#8 or PKCS#1; a public key fails too (c004 design.md D6). The
/// message names the setting, never its value or any part of it.
/// </summary>
public sealed class EnableBankingOptionsValidator : IValidateOptions<EnableBankingOptions> {
  private const string PKCS8_LABEL = "PRIVATE KEY";
  private const string PKCS1_LABEL = "RSA PRIVATE KEY";

  private const string NOT_AN_RSA_PRIVATE_KEY =
    $"{nameof(EnableBankingOptions)}.{nameof(EnableBankingOptions.PrivateKey)} is not an RSA private key in PEM form: "
    + $"expected exactly one unencrypted key, labelled \"{PKCS8_LABEL}\" (PKCS#8) or \"{PKCS1_LABEL}\" (PKCS#1).";

  public ValidateOptionsResult Validate(string? name, EnableBankingOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    return IsRsaPrivateKeyPem(options.PrivateKey) ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(NOT_AN_RSA_PRIVATE_KEY);
  }

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