using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.UnitTests.Push;

/// <summary>
/// The known push services' own guard (c011 design.md D9; #97): an entry of <c>Push:Services</c> that is not a push service
/// pattern stops <see cref="KnownPushServices"/> from being made, rather than let it match nothing unnoticed, and the
/// message names the entry by its full name, as the operator sets it (<c>Push:Services:&lt;name&gt;</c>), never its value.
/// In the app the start-up check refuses such an entry first (<see cref="PushOptionsValidator"/>), so the guard never fires
/// there; these tests make the class directly, from settings that skip that check (<see cref="Options.Create{TOptions}"/>),
/// the one way to reach it. Every value here is made up.
/// </summary>
public sealed class KnownPushServicesTests {
  /// <summary>The values the known push services never read: only the services are their business.</summary>
  private const string NOT_READ = "made up, not read by the known push services";

  /// <summary>The broken entry's name, distinctive, so it cannot turn up in a message by coincidence.</summary>
  private const string ENTRY = "Elsewhere5b2e";

  /// <summary>Valid entries next to the broken one, which the message must not name.</summary>
  private static readonly Dictionary<string, string> _validServices = new(StringComparer.Ordinal) {
    ["Google"] = "https://fcm.googleapis.com",
    ["Apple"] = "https://*.push.apple.com",
  };

  /// <param name="pattern">Not a push service pattern (D9).</param>
  [Test]
  [Arguments("https://fcm.googleapis.com/fcm/send")] // a path
  [Arguments("http://fcm.googleapis.com")] // plain http on a host that is not loopback
  [Arguments("https://push.*.apple.com")] // a wildcard in the middle
  public void A_known_push_service_that_is_not_a_pattern_stops_the_class_and_the_message_opens_with_the_entry_full_name_never_its_value(string pattern) {
    Dictionary<string, string> services = new(_validServices, StringComparer.Ordinal) { [ENTRY] = pattern };

    string message = Should.Throw<InvalidOperationException>(() => new KnownPushServices(Settings(services)), "the guard stops the class").Message;

    string fullName = $"{PushOptions.SECTION}:{nameof(PushOptions.Services)}:{ENTRY}";
    message.ShouldSatisfyAllConditions(
      () => message.ShouldStartWith($"{fullName} is not a push service pattern", customMessage: $"the message opens with {fullName}", caseSensitivity: Case.Sensitive),
      () => message.ShouldNotContain($"({PushOptions.SECTION}:{nameof(PushOptions.Services)})", caseSensitivity: Case.Sensitive, customMessage: "the setting is named in full with the entry, not after it"),
      () => message.ShouldNotContain(pattern, caseSensitivity: Case.Sensitive, customMessage: "no message may contain the entry's value"),
      () => _validServices.Keys.ShouldAllBe(valid => !message.Contains(valid, StringComparison.Ordinal), "the message names no entry that is valid"));
  }

  /// <summary>Push settings holding <paramref name="services"/>, made without the start-up check, as only a test can.</summary>
  private static IOptions<PushOptions> Settings(IReadOnlyDictionary<string, string> services) =>
    Options.Create(new PushOptions {
      VapidPublicKey = NOT_READ,
      VapidPrivateKey = NOT_READ,
      MessageKey = NOT_READ,
      Subject = new Uri("https://app.example.net"),
      Services = services,
    });
}