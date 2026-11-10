using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.PushSending;

public sealed class PushSendingScenarios : AcceptanceTest {
  /// <summary>An account that has left the allowlist, made up.</summary>
  private const string FORMER_ACCOUNT = "drivejsi.ucet@example.com";

  [Test, Scenario("push-sending", "A registered device receives a message sent to its account")]
  public async Task A_registered_device_receives_a_message_sent_to_its_account() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj", text: "Zkušební zpráva", page: "/");

    PushReceived push = Push.PushServiceReceived(phone).ShouldHaveSingleItem();
    push.SignedWithServerKey.ShouldBeTrue("signed with the server's push key for that push service");
    push.Title.ShouldBe("Ahoj");
    push.Text.ShouldBe("Zkušební zpráva");
    push.Navigate.ShouldBe(Push.AppAddressOf("/"));
    answer.ShouldBe(MessageAnswer.Counts(delivered: 1, failed: 0, removed: 0));
  }

  [Test, Scenario("push-sending", "A message reaches every device of the account and none of another account's")]
  public async Task A_message_reaches_every_device_of_the_account_and_none_of_another_accounts() {
    PhoneForPush luciesPhone = Push.NewPhone("Lucie's phone");
    PhoneForPush luciesTablet = Push.NewPhone("Lucie's tablet");
    PhoneForPush petrsPhone = Push.NewPhone("Petr's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(luciesPhone);
    await Push.HasRegistered(luciesTablet);
    SignIn.IsOnTheAllowlist(Visitor.Petr.Email);
    await SignIn.HasSignedIn(Visitor.Petr);
    await Push.HasRegistered(petrsPhone);

    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");

    Push.Received(luciesPhone).ShouldHaveSingleItem().Title.ShouldBe("Ahoj");
    Push.Received(luciesTablet).ShouldHaveSingleItem().Title.ShouldBe("Ahoj");
    Push.PushServiceReceived(petrsPhone).ShouldBeEmpty("Petr's phone receives nothing");
    answer.Delivered.ShouldBe(2);
  }

  [Test, Scenario("push-sending", "An allowed account with no devices gets zero counts")]
  public async Task An_allowed_account_with_no_devices_gets_zero_counts() {
    SignIn.IsOnTheAllowlist(Visitor.Petr.Email);

    (await Push.OwnerSends(Visitor.Petr.Email, "Ahoj")).ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 0, removed: 0));
  }

  [Test, Scenario("push-sending", "Every push lives 24 hours and is urgent")]
  public async Task Every_push_lives_24_hours_and_is_urgent() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");

    PushReceived push = Push.PushServiceReceived(phone).ShouldHaveSingleItem();
    push.LifetimeSeconds.ShouldBe(86400);
    push.Urgency.ShouldBe("high");
  }

  [Test, Scenario("push-sending", "A message without the right key gets the answer of an unknown address")]
  public async Task A_message_without_the_right_key_gets_the_answer_of_an_unknown_address() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    WholeAnswer answer = await Push.SomeoneSendsWithAWrongKey(Visitor.Lucie.Email, "Ahoj");

    answer.Problem.ShouldBe(ProblemDescription.NotFound);
    answer.ShouldBe(await Push.AnUnknownApiAddressAnswers());
    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone's push service receives nothing");
  }

  [Test, Scenario("push-sending", "A message to an account not on the allowlist is refused")]
  public async Task A_message_to_an_account_not_on_the_allowlist_is_refused() {
    SignIn.IsNotOnTheAllowlist(Visitor.Stranger.Email);

    (await Push.OwnerSends(Visitor.Stranger.Email, "Ahoj")).ShouldBe(MessageAnswer.Refused(ProblemDescription.PushAccountNotAllowed));
    Push.PushesAnyPushServiceReceived().ShouldBe(0, "no push service receives anything");
  }

  [Test, Scenario("push-sending", "A message to an account no longer on the allowlist deletes its devices")]
  public async Task A_message_to_an_account_no_longer_on_the_allowlist_deletes_its_devices() {
    PhoneForPush phone = Push.NewPhone("the former account's phone");
    SignIn.IsNotOnTheAllowlist(FORMER_ACCOUNT);
    await Push.DeviceRegisteredFor(phone, FORMER_ACCOUNT);

    MessageAnswer answer = await Push.OwnerSends(FORMER_ACCOUNT, "Ahoj");

    answer.ShouldBe(MessageAnswer.Refused(ProblemDescription.PushAccountNotAllowed));
    (await Push.IsRegistered(phone)).ShouldBeFalse("the phone is no longer registered");
    Push.PushServiceReceived(phone).ShouldBeEmpty("its push service receives nothing");
  }

  [Test, Scenario("push-sending", "A message without a title is refused")]
  public async Task A_message_without_a_title_is_refused() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, title: null, text: "Zkušební zpráva");

    answer.ShouldBe(MessageAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.Title));
    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone's push service receives nothing");
  }

  [Test, Scenario("push-sending", "A message whose page is not a page of the app is refused")]
  public async Task A_message_whose_page_is_not_a_page_of_the_app_is_refused() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj", page: "https://example.com/");

    answer.ShouldBe(MessageAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.Page));
    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone's push service receives nothing");
  }

  [Test, Scenario("push-sending", "A message too long for a push is refused")]
  public async Task A_message_too_long_for_a_push_is_refused() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj", text: new string('a', 4000));

    answer.ShouldBe(MessageAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.Message));
    Push.PushServiceReceived(phone).ShouldBeEmpty("her phone's push service receives nothing");
  }

  [Test, Scenario("push-sending", "A device the push service reports gone is deleted")]
  public async Task A_device_the_push_service_reports_gone_is_deleted() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Push.PushServiceSaysGone(phone);

    MessageAnswer first = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");
    MessageAnswer second = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj znovu");

    first.ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 0, removed: 1));
    second.ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 0, removed: 0));
    Push.PushServiceReceived(phone).ShouldHaveSingleItem().Title.ShouldBe("Ahoj", "the push service receives only the first");
  }

  [Test, Scenario("push-sending", "A device whose push service fails is counted as failed and kept")]
  public async Task A_device_whose_push_service_fails_is_counted_as_failed_and_kept() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    Push.PushServiceFailsOnce(phone);

    MessageAnswer first = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");
    MessageAnswer second = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj znovu");

    first.ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 1, removed: 0));
    second.Delivered.ShouldBe(1);
    Push.Received(phone).ShouldHaveSingleItem().Title.ShouldBe("Ahoj znovu", "the phone receives the second");
  }
}