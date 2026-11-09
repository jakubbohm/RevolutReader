using System.Buffers.Text;
using System.Security.Cryptography;
using Microsoft.Extensions.Primitives;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The message key's check (c011 design.md D10): the key sent in the request's header matches the configured message key
/// when it is that key, sent once; a wrong key, no key, a key sent twice or a key of another length does not match. The
/// keys are made up per test, as the owner's block makes one (32 random bytes, base64url), and longer, since the settings
/// allow at least 32 bytes.
/// </summary>
public sealed class MessageKeyCheckTests {
  /// <summary>The message key's size the owner's block makes (D5).</summary>
  private const int KEY_BYTES = 32;

  /// <param name="bytes">The key's size: the 32 bytes the owner's block makes, or more.</param>
  [Test]
  [Arguments(32)]
  [Arguments(64)]
  public void The_right_message_key_matches(int bytes) {
    string messageKey = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));

    MessageKeyCheck.Matches(new StringValues(messageKey), messageKey).ShouldBeTrue();
  }

  /// <summary>
  /// Another key of the same length, and the key with only its last character changed (so a check that compares a part
  /// of the key, or stops early, still refuses it).
  /// </summary>
  [Test]
  public void A_wrong_message_key_does_not_match() {
    string messageKey = MadeUpKey();
    string anotherKey = MadeUpKey();
    string lastCharacterChanged = messageKey[..^1] + (messageKey[^1] == 'A' ? 'B' : 'A');

    messageKey.ShouldSatisfyAllConditions(
      () => MessageKeyCheck.Matches(new StringValues(anotherKey), messageKey).ShouldBeFalse("another key of the same length"),
      () => MessageKeyCheck.Matches(new StringValues(lastCharacterChanged), messageKey).ShouldBeFalse("the key with its last character changed"));
  }

  /// <summary>No header at all (no values, as ASP.NET hands over an absent header, also as <c>default</c>), and a header with an empty value.</summary>
  [Test]
  public void A_missing_message_key_does_not_match() {
    string messageKey = MadeUpKey();

    messageKey.ShouldSatisfyAllConditions(
      () => MessageKeyCheck.Matches(StringValues.Empty, messageKey).ShouldBeFalse("no header: no values"),
      () => MessageKeyCheck.Matches(default, messageKey).ShouldBeFalse("no header: the default value"),
      () => MessageKeyCheck.Matches(new StringValues(string.Empty), messageKey).ShouldBeFalse("a header with an empty value"));
  }

  /// <summary>
  /// The header twice (two values): the right key twice, and the right key with a wrong one on either line, so neither a
  /// check that takes the first or the last value, nor one that looks for the key among the values, passes it.
  /// </summary>
  [Test]
  public void A_message_key_sent_twice_does_not_match() {
    string messageKey = MadeUpKey();
    string wrongKey = MadeUpKey();

    messageKey.ShouldSatisfyAllConditions(
      () => MessageKeyCheck.Matches(new StringValues([messageKey, messageKey]), messageKey).ShouldBeFalse("the right key on both lines"),
      () => MessageKeyCheck.Matches(new StringValues([messageKey, wrongKey]), messageKey).ShouldBeFalse("the right key, then a wrong one"),
      () => MessageKeyCheck.Matches(new StringValues([wrongKey, messageKey]), messageKey).ShouldBeFalse("a wrong key, then the right one"));
  }

  /// <summary>
  /// Keys that differ from the message key only in length: the key one character short and the key one character longer
  /// (each shares the other's whole beginning, so a check that compares only the shorter length, or a beginning, passes
  /// them), and the key twice over.
  /// </summary>
  [Test]
  public void A_message_key_of_another_length_does_not_match() {
    string messageKey = MadeUpKey();

    messageKey.ShouldSatisfyAllConditions(
      () => MessageKeyCheck.Matches(new StringValues(messageKey[..^1]), messageKey).ShouldBeFalse("the key one character short"),
      () => MessageKeyCheck.Matches(new StringValues(messageKey + "A"), messageKey).ShouldBeFalse("the key one character longer"),
      () => MessageKeyCheck.Matches(new StringValues(messageKey + messageKey), messageKey).ShouldBeFalse("the key twice over"));
  }

  /// <summary>A made-up message key, as the owner's block makes one: 32 random bytes in base64url.</summary>
  private static string MadeUpKey() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(KEY_BYTES));
}