using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.AcceptanceTests.Traceability;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Scenarios.PushDevices;

public sealed class PushDevicesScenarios : AcceptanceTest {
  [Test, Scenario("push-devices", "The app gets the public push key")]
  public async Task The_app_gets_the_public_push_key() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Push.AsksForThePushKey()).ShouldBe(Push.ServerPushKey);
  }

  [Test, Scenario("push-devices", "Registering the same device again moves it to the account signed in now")]
  public async Task Registering_the_same_device_again_moves_it_to_the_account_signed_in_now() {
    PhoneForPush phone = Push.NewPhone("the shared phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);
    await SignIn.SignsOut();
    SignIn.IsOnTheAllowlist(Visitor.Petr.Email);
    await SignIn.HasSignedIn(Visitor.Petr);
    await Push.HasRegistered(phone);

    await Push.OwnerSends(Visitor.Lucie.Email, "Pro Lucii");
    await Push.OwnerSends(Visitor.Petr.Email, "Pro Petra");

    Push.PushServiceReceived(phone).ShouldNotContain(push => push.Title == "Pro Lucii", "Lucie's message reaches no device");
    Push.Received(phone).ShouldContain(push => push.Title == "Pro Petra", "Petr's message reaches the phone");
  }

  [Test, Scenario("push-devices", "A push address outside the known push services is refused")]
  public async Task A_push_address_outside_the_known_push_services_is_refused() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Push.RegistersAt("https://push.example.com/device-1")).ShouldBe(RegistrationAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.PushAddress));
    // The address is outside the fake push service, so no push service of the test could show a push to it: reaching no
    // device shows in the answer, which counts no device at all.
    (await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj")).ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 0, removed: 0));
  }

  [Test, Scenario("push-devices", "A subscription with missing or wrong-sized keys is refused")]
  public async Task A_subscription_with_missing_or_wrong_sized_keys_is_refused() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Push.RegistersWithSecretOfBytes(phone, 8)).ShouldBe(RegistrationAnswer.Refused(ProblemDescription.BadRequest, naming: RequestPart.Secret));
    await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");
    Push.PushServiceReceived(phone).ShouldBeEmpty("a message to Lucie reaches no device");
  }

  [Test, Scenario("push-devices", "A forgotten device gets no more messages")]
  public async Task A_forgotten_device_gets_no_more_messages() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(phone);

    await Push.Forgets(phone);
    MessageAnswer answer = await Push.OwnerSends(Visitor.Lucie.Email, "Ahoj");

    Push.PushServiceReceived(phone).ShouldBeEmpty("the message reaches no device");
    answer.ShouldBe(MessageAnswer.Counts(delivered: 0, failed: 0, removed: 0));
  }

  [Test, Scenario("push-devices", "Forgetting a device that was never registered is fine")]
  public async Task Forgetting_a_device_that_was_never_registered_is_fine() {
    PhoneForPush phone = Push.NewPhone("Lucie's phone");
    await SignIn.HasSignedIn(Visitor.Lucie);

    (await Push.Forgets(phone)).ShouldBe(ForgetAnswer.Forgotten);
  }
}