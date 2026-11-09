using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.Extensions.Primitives;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The message key's check (c011 design.md D10): the key sent in the request's header matches the configured message key
/// when it is that key. The keys are made up per test, as the owner's block makes one (32 random bytes, base64url), and
/// longer, since the settings allow at least 32 bytes.
/// </summary>
public sealed class MessageKeyCheckTests {
  /// <param name="bytes">The key's size: the 32 bytes the owner's block makes, or more.</param>
  [Test]
  [Arguments(32)]
  [Arguments(64)]
  public void The_right_message_key_matches(int bytes) {
    string messageKey = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));

    MessageKeyCheck.Matches(new StringValues(messageKey), messageKey).ShouldBeTrue();
  }
}