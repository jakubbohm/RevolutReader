using System.Security.Cryptography;

namespace RevolutReader.Api.Bank;

/// <summary>
/// The token every request to Enable Banking carries (c004 design.md § Context, § Rule ownership): a JWT signed by the
/// application's private key.
/// </summary>
public sealed class ApplicationToken {
  public ApplicationToken(string applicationId, RSA key) {
  }

  /// <summary>RS256; header kid = application id; iss enablebanking.com, aud api.enablebanking.com, iat = now, exp = now + 1 h. BCL only.</summary>
  public string Create(DateTimeOffset now) => throw new NotImplementedException();
}