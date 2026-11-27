using System.Text;
using System.Text.Json;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// A notification about the account carries its balance in the address a tap opens (c019 design.md D1, D2; spec
/// push-sending): a message with a balance becomes a plain Declarative Web Push, with no <c>"mutable"</c> and no
/// <c>notification.data</c>, whose <c>navigate</c> is the page with <c>#</c> and <see cref="BalanceInAddress.Fragment"/>
/// for the device's secret, in place of a fragment the page has; the size check measures it with that fragment. A message
/// without a balance is written as before, and a secret given with it is not read. C8a's tests of a message without a
/// balance (<see cref="PushMessagesTests"/>) are unchanged; c014's tests here pinned <c>mutable</c> and
/// <c>data.balance</c>, and now pin their absence (the payload's values as <c>GET /api/balance</c> writes them are
/// <see cref="BalanceInAddressTests"/>'). The JSON is read as a browser reads it, by member and value. The fragments are
/// known answers Node's crypto made (design.md D12's vector, and the same balance under a second secret), outside both
/// implementations. The app's address is made up, an https origin of a reserved domain; the balance and the secrets are
/// made up.
/// </summary>
public sealed class PushMessagesWithBalanceTests {
  /// <summary>The most bytes of JSON a push may carry (c011 design.md D2).</summary>
  private const int MOST_BYTES = 3993;

  /// <summary>design.md D12's known-answer vector: the fragment for its balance under the secret 0x00 to 0x0f.</summary>
  private const string VECTOR_FRAGMENT =
    "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

  /// <summary>The vector's payload, the fragment's text between <c>balance=</c> and the <c>.</c>.</summary>
  private const string VECTOR_PAYLOAD = "eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ";

  /// <summary>The vector's check code, under the secret 0x00 to 0x0f.</summary>
  private const string VECTOR_CODE = "gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

  /// <summary>The check code of the vector's payload under the secret 0x10 to 0x1f, made by Node's crypto as the vector was.</summary>
  private const string OTHER_SECRETS_CODE = "ozL1Qb-hh4IaDjtFA2BQv2G_L3Kj_abbpow3_myjGDE";

  /// <summary>The bytes a balance's fragment adds to <c>navigate</c> of a page without one: the <c>#</c> and the fragment, all ASCII, none escaped in JSON.</summary>
  private const int FRAGMENT_BYTES = 1 + 146;

  private static readonly Uri _appAddress = new("https://app.example.net");

  /// <summary>The vector's balance: 45.20 euros, read 2026-11-21T09:14:03+00:00, at 24.6 koruna per euro.</summary>
  private static readonly PushBalance _vectorBalance = new(45.20m, new DateTimeOffset(2026, 11, 21, 9, 14, 3, TimeSpan.Zero), 24.6m);

  /// <summary>The vector's secret, the bytes 0x00 to 0x0f.</summary>
  private static readonly byte[] _vectorSecret = SecretFrom(0);

  /// <summary>The check's notification for a fall to 45.20, as c014 design.md D14's example, with the vector's balance: its title, text, the start page and the balance.</summary>
  private static readonly PushMessage _accountNotification = new(
    "Odešlo 3,80 €",
    "Zůstatek 45,20 € (≈ 1 112 Kč)",
    "/",
    _vectorBalance);

  /// <summary>
  /// The push is plain: <c>web_push</c> and <c>notification</c> only, no <c>mutable</c> at its top level, and the
  /// notification has its title, text and <c>navigate</c>, no <c>data</c>. <c>navigate</c> is the start page with
  /// <c>#</c> and the balance's fragment, its code made with the secret given: the vector's secret gives the vector, another
  /// secret the same payload under its own code.
  /// </summary>
  /// <param name="firstByte">The secret's first byte; the secret is the 16 bytes counting up from it.</param>
  /// <param name="code">The check code Node's crypto made for the vector's payload under that secret.</param>
  [Test]
  [Arguments(0x00, VECTOR_CODE)] // design.md D12's vector
  [Arguments(0x10, OTHER_SECRETS_CODE)] // another device's secret
  public void A_message_with_a_balance_has_no_mutable_and_no_data_and_its_navigate_is_the_start_page_with_the_fragment_for_the_given_secret(int firstByte, string code) {
    JsonElement json = DeclarativeJson(_accountNotification, SecretFrom(firstByte));

    JsonElement notification = json.GetProperty("notification");
    json.ShouldSatisfyAllConditions(
      () => MemberNames(json).ShouldBe(["web_push", "notification"], ignoreOrder: true, "no mutable at the message's top level"),
      () => MemberNames(notification).ShouldBe(["title", "body", "navigate"], ignoreOrder: true, "no data in the notification, beside its title, text and page"),
      () => notification.GetProperty("navigate").GetString().ShouldBe($"https://app.example.net/#balance={VECTOR_PAYLOAD}.{code}", "the start page with # and the balance's fragment for the given secret"));
  }

  /// <summary>
  /// A page with a fragment of its own gets the balance's in its place (D2), whatever its path and query: only one
  /// fragment, the balance's, follows the <c>#</c>.
  /// </summary>
  /// <param name="page">The message's page, with a fragment of its own.</param>
  /// <param name="opened">The address the page opens, without its fragment.</param>
  [Test]
  [Arguments("/#jinde", "https://app.example.net/")] // the start page
  [Arguments("/transakce?od=1#jinde", "https://app.example.net/transakce?od=1")] // a path and a query
  public void The_balances_fragment_takes_the_place_of_a_fragment_the_page_has(string page, string opened) {
    string? navigate = DeclarativeJson(_accountNotification with { Page = page }, _vectorSecret)
      .GetProperty("notification").GetProperty("navigate").GetString();

    navigate.ShouldBe($"{opened}#{VECTOR_FRAGMENT}", "the page's own fragment replaced by the balance's");
  }

  /// <summary>
  /// <see cref="PushMessages.Check"/> measures a message with a balance with its fragment, whose length does not depend on
  /// the secret (D2): the check's own notification fits; a message that is exactly 3993 bytes with the fragment fits; one a
  /// byte longer is refused as too long, naming <c>message</c>, though without the balance it is just under 3993 bytes and
  /// fits.
  /// </summary>
  [Test]
  public void Check_measures_a_message_with_a_balance_with_its_fragment_so_one_just_under_3993_bytes_without_it_and_over_with_it_is_refused_as_too_long() {
    VECTOR_FRAGMENT.Length.ShouldBe(FRAGMENT_BYTES - 1, "the test's own count of the fragment's bytes");
    PushMessage atTheLimitWithTheFragment = AsciiMessageOfBytes(MOST_BYTES - FRAGMENT_BYTES) with { Balance = _vectorBalance };
    PushMessage justUnderWithoutTheFragment = AsciiMessageOfBytes(MOST_BYTES - FRAGMENT_BYTES + 1);

    justUnderWithoutTheFragment.ShouldSatisfyAllConditions(
      () => PushMessages.Check(_accountNotification, _appAddress).ShouldBeEmpty("the check's notification, with its balance, fits a push"),
      () => PushMessages.Check(atTheLimitWithTheFragment, _appAddress).ShouldBeEmpty("3993 bytes with the fragment fit"),
      () => PushMessages.Check(justUnderWithoutTheFragment, _appAddress).ShouldBeEmpty("just under 3993 bytes without a balance fit"),
      () => PushMessages.Check(justUnderWithoutTheFragment with { Balance = _vectorBalance }, _appAddress)
        .ShouldHaveSingleItem("the same message with a balance is a byte over with its fragment").Member.ShouldBe("message"));
  }

  /// <summary>
  /// A message without a balance is the same plain push whatever secret is given, and whether one is given at all: a
  /// device's secret, none, or one of a length no device has, which a message with a balance would refuse, are never read.
  /// </summary>
  /// <param name="length">The secret's length in bytes.</param>
  [Test]
  [Arguments(16)] // a device's secret
  [Arguments(0)] // none
  [Arguments(5)] // a length no device has
  public void A_message_without_a_balance_is_written_as_before_and_a_secret_given_with_it_is_not_read(int length) {
    PushMessage withoutBalance = _accountNotification with { Balance = null, Page = "/transakce" };
    byte[] secret = [.. SecretFrom(0x20).Take(length)];

    string written = PushMessages.DeclarativeJson(withoutBalance, _appAddress, secret);

    JsonElement json = DeclarativeJson(withoutBalance, secret);
    JsonElement notification = json.GetProperty("notification");
    written.ShouldSatisfyAllConditions(
      () => written.ShouldBe(PushMessages.DeclarativeJson(withoutBalance, _appAddress), "the same JSON as without a secret"),
      () => MemberNames(json).ShouldBe(["web_push", "notification"], ignoreOrder: true),
      () => MemberNames(notification).ShouldBe(["title", "body", "navigate"], ignoreOrder: true),
      () => notification.GetProperty("navigate").GetString().ShouldBe("https://app.example.net/transakce", "the page, with no fragment"));
  }

  /// <summary>The 16 bytes counting up from <paramref name="firstByte"/>: a made-up secret.</summary>
  private static byte[] SecretFrom(int firstByte) => [.. Enumerable.Range(firstByte, 16).Select(static value => (byte)value)];

  /// <summary>
  /// A message with no balance whose JSON is exactly <paramref name="bytes"/> bytes, padded with ASCII letters in its text,
  /// measured on <see cref="PushMessages.DeclarativeJson"/>, as c011's size tests build theirs.
  /// </summary>
  private static PushMessage AsciiMessageOfBytes(int bytes) {
    PushMessage frame = new("Zůstatek se změnil", string.Empty, "/transakce");
    PushMessage message = frame with { Text = new string('x', bytes - JsonBytes(frame)) };

    JsonBytes(message).ShouldBe(bytes, "the test's own message is the size it means to be");

    return message;
  }

  /// <summary>The UTF-8 bytes of the message's JSON on the made-up app address.</summary>
  private static int JsonBytes(PushMessage message) => Encoding.UTF8.GetByteCount(PushMessages.DeclarativeJson(message, _appAddress));

  /// <summary>The message's JSON for the made-up app address and <paramref name="secret"/>, parsed as a browser reads it.</summary>
  private static JsonElement DeclarativeJson(PushMessage message, byte[] secret) {
    using JsonDocument document = JsonDocument.Parse(PushMessages.DeclarativeJson(message, _appAddress, secret));

    return document.RootElement.Clone();
  }

  private static string[] MemberNames(JsonElement element) => [.. element.EnumerateObject().Select(static member => member.Name)];
}
