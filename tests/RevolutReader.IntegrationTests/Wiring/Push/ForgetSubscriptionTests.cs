using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using RevolutReader.Api.Push;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// Forgetting a device at the subscription endpoint (spec push-devices, "A device can be forgotten"; c011 design.md D9;
/// tasks 47.1, 48.1, 50.1, 50.2): <c>DELETE /api/push/subscription</c> with <c>{ "endpoint" }</c> as its JSON body
/// forgets the device with that push address and answers 204 with no content; the other devices stay. An address not
/// stored, or none, answers 204 the same and forgets nothing. A request without a JSON body never
/// reaches the endpoint (its body is declared with <c>Accepts</c>, D9) and gets exactly the answer an unknown <c>/api</c>
/// address gets; a request from nobody signed in, or from an account not on the allowlist, is refused as at any other
/// address behind sign-in, and nothing is forgotten. The scenario pins forgetting through the DSL; here the answer's
/// shape, the other devices and the refusals. Each test has its own app copy (<see cref="SubscriptionEndpointApp"/>); the
/// devices are put into its store directly, made up.
/// </summary>
public sealed class ForgetSubscriptionTests {
  private const string JSON = "application/json";
  private const string UNKNOWN_API_ADDRESS = "/api/no-such-address";

  private const string LUCIE = MessageEndpointApp.ALLOWED_ACCOUNT;
  private const string PETR = "petr@example.com";

  /// <summary>Not on the app copy's allowlist, made up.</summary>
  private const string EVA = "eva@example.com";

  /// <summary>The one member a problem description carries that differs per request.</summary>
  private const string TRACE_ID = "traceId";

  [Test]
  public async Task Forgetting_a_stored_device_answers_204_with_no_content_and_removes_only_that_device() {
    await using SubscriptionEndpointApp app = new();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", LUCIE);
    PushDevice luciesTablet = Device($"https://web.push.apple.com/{MadeUpToken()}", LUCIE);
    PushDevice petrsLaptop = Device($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", PETR);
    await Store(app, luciesPhone, luciesTablet, petrsLaptop);
    using HttpClient lucie = app.SignedInAs(LUCIE);

    using HttpResponseMessage response = await Forget(lucie, SubscriptionEndpointApp.SUBSCRIPTION, ForgetBody(luciesPhone.Endpoint), JSON);
    string content = await response.Content.ReadAsStringAsync();

    response.ShouldSatisfyAllConditions(
      () => response.StatusCode.ShouldBe(HttpStatusCode.NoContent, content),
      () => content.ShouldBeEmpty());
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([luciesTablet, petrsLaptop], ignoreOrder: true, "only Lucie's phone is gone");
  }

  /// <summary>
  /// Forgetting an address no device is stored under answers 204 too (D9, spec push-devices: so a browser can always
  /// forget its device, e.g. at sign-out), never a 404, and forgets nothing, also when the address only resembles the
  /// stored one (tasks 50.1, 48.1).
  /// </summary>
  /// <param name="notStored">The forgotten address: one never stored, or one that resembles Lucie's phone's.</param>
  [Test]
  [Arguments("an address never stored")]
  [Arguments("the phone's address with its token in upper case")]
  [Arguments("the phone's address cut short by one character")]
  public async Task Forgetting_a_push_address_that_is_not_stored_answers_204_and_forgets_nothing(string notStored) {
    await using SubscriptionEndpointApp app = new();
    string token = MadeUpToken();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{token}", LUCIE);
    await Store(app, luciesPhone);
    using HttpClient lucie = app.SignedInAs(LUCIE);
    string pushAddress = notStored switch {
      "an address never stored" => $"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}",
      "the phone's address with its token in upper case" => $"https://fcm.googleapis.com/fcm/send/{token.ToUpperInvariant()}",
      "the phone's address cut short by one character" => luciesPhone.Endpoint[..^1],
      _ => throw new ArgumentOutOfRangeException(nameof(notStored), notStored, "Not a known case."),
    };

    using HttpResponseMessage response = await Forget(lucie, SubscriptionEndpointApp.SUBSCRIPTION, ForgetBody(pushAddress), JSON);

    await ShouldAnswer204WithNoContent(response);
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([luciesPhone], "nothing is forgotten");
  }

  /// <summary>
  /// Forgetting without a push address answers 204 too (D9: no address is fine), never a 400 for a missing member, and
  /// forgets nothing, never every device (task 50.2).
  /// </summary>
  /// <param name="body">A JSON body without a push address.</param>
  [Test]
  [Arguments("{}")] // left out
  [Arguments("""{ "endpoint": null }""")]
  [Arguments("""{ "endpoint": "" }""")]
  [Arguments("""{ "endpoint": "   " }""")]
  public async Task Forgetting_without_a_push_address_answers_204_and_forgets_nothing(string body) {
    await using SubscriptionEndpointApp app = new();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", LUCIE);
    PushDevice petrsLaptop = Device($"https://updates.push.services.mozilla.com/wpush/v2/{MadeUpToken()}", PETR);
    await Store(app, luciesPhone, petrsLaptop);
    using HttpClient lucie = app.SignedInAs(LUCIE);

    using HttpResponseMessage response = await Forget(lucie, SubscriptionEndpointApp.SUBSCRIPTION, body, JSON);

    await ShouldAnswer204WithNoContent(response);
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([luciesPhone, petrsLaptop], ignoreOrder: true, "nothing is forgotten");
  }

  /// <summary>
  /// A request whose body is not declared JSON never reaches the endpoint (D9: the body is declared with
  /// <c>Accepts</c>), so it gets exactly the answer the same request gets at an address under <c>/api</c> no endpoint
  /// serves, compared whole apart from <c>traceId</c>, and the device it names stays.
  /// </summary>
  /// <param name="contentType">The request's content type, or <see langword="null"/> for no body at all.</param>
  [Test]
  [Arguments(null)] // no body
  [Arguments("text/plain")] // the JSON, but not declared JSON
  public async Task A_forget_request_without_a_JSON_body_gets_the_answer_of_an_unknown_address(string? contentType) {
    await using SubscriptionEndpointApp app = new();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", LUCIE);
    await Store(app, luciesPhone);
    using HttpClient lucie = app.SignedInAs(LUCIE);
    string? body = contentType is null ? null : ForgetBody(luciesPhone.Endpoint);

    string atTheEndpoint = await WholeAnswer(lucie, SubscriptionEndpointApp.SUBSCRIPTION, body, contentType);
    string atAnUnknownAddress = await WholeAnswer(lucie, UNKNOWN_API_ADDRESS, body, contentType);

    atAnUnknownAddress.ShouldStartWith($"{(int)HttpStatusCode.NotFound} ", Case.Sensitive, "an unknown /api address answers 404");
    atTheEndpoint.ShouldBe(atAnUnknownAddress, "a forget request without a JSON body answers exactly as an unknown /api address");
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([luciesPhone], "nothing is forgotten");
  }

  /// <summary>
  /// Forgetting is behind sign-in like every other address the app serves (D9: signed-in, allowed users): nobody signed
  /// in gets 401, an account not on the allowlist 403, and the device the request names stays.
  /// </summary>
  /// <param name="caller">Who sends the request.</param>
  /// <param name="refusal">The status every address behind sign-in answers that caller with.</param>
  [Test]
  [Arguments("nobody signed in", HttpStatusCode.Unauthorized)]
  [Arguments("an account not on the allowlist", HttpStatusCode.Forbidden)]
  public async Task A_forget_request_from_someone_not_allowed_is_refused_and_forgets_nothing(string caller, HttpStatusCode refusal) {
    await using SubscriptionEndpointApp app = new();
    PushDevice luciesPhone = Device($"https://fcm.googleapis.com/fcm/send/{MadeUpToken()}", LUCIE);
    await Store(app, luciesPhone);
    using HttpClient client = caller switch {
      "nobody signed in" => app.CreateClient(),
      "an account not on the allowlist" => app.SignedInAs(EVA),
      _ => throw new ArgumentOutOfRangeException(nameof(caller), caller, "Not a known case."),
    };

    using HttpResponseMessage response = await Forget(client, SubscriptionEndpointApp.SUBSCRIPTION, ForgetBody(luciesPhone.Endpoint), JSON);

    response.StatusCode.ShouldBe(refusal, await response.Content.ReadAsStringAsync());
    (await app.Devices.ReadAll(CancellationToken.None)).ShouldBe([luciesPhone], "nothing is forgotten");
  }

  private static async Task ShouldAnswer204WithNoContent(HttpResponseMessage response) {
    string content = await response.Content.ReadAsStringAsync();

    response.ShouldSatisfyAllConditions(
      () => response.StatusCode.ShouldBe(HttpStatusCode.NoContent, content),
      () => content.ShouldBeEmpty());
  }

  private static async Task Store(SubscriptionEndpointApp app, params PushDevice[] devices) {
    foreach (PushDevice device in devices)
      await app.Devices.Save(device, CancellationToken.None);
  }

  /// <summary><c>DELETE</c> to <paramref name="address"/> with <paramref name="body"/> of <paramref name="contentType"/>, or no body when either is <see langword="null"/>.</summary>
  private static async Task<HttpResponseMessage> Forget(HttpClient client, string address, string? body, string? contentType) {
    using HttpRequestMessage request = new(HttpMethod.Delete, new Uri(address, UriKind.Relative));

    if (body is not null && contentType is not null)
      request.Content = new StringContent(body, Encoding.UTF8, contentType);

    return await client.SendAsync(request);
  }

  /// <summary>The answer to a <c>DELETE</c> as one text: the status, the content type and the body, a JSON object's without its <c>traceId</c>.</summary>
  private static async Task<string> WholeAnswer(HttpClient client, string address, string? body, string? contentType) {
    using HttpResponseMessage response = await Forget(client, address, body, contentType);
    string answer = await response.Content.ReadAsStringAsync();

    return $"{(int)response.StatusCode} {response.Content.Headers.ContentType} {WithoutTraceId(answer)}";
  }

  /// <summary><paramref name="body"/> without its <c>traceId</c> when it is a JSON object; otherwise as it is.</summary>
  private static string WithoutTraceId(string body) {
    JsonNode? parsed;

    try {
      parsed = JsonNode.Parse(body);
    }
    catch (System.Text.Json.JsonException) {
      return body;
    }

    if (parsed is not JsonObject problem)
      return body;

    _ = problem.Remove(TRACE_ID);

    return problem.ToJsonString();
  }

  /// <summary>The app's forget request: <c>{ "endpoint" }</c> (D9).</summary>
  private static string ForgetBody(string pushAddress) => $$"""{ "endpoint": "{{pushAddress}}" }""";

  /// <summary>A device at <paramref name="pushAddress"/> under <paramref name="account"/>, with made-up keys forgetting does not read.</summary>
  private static PushDevice Device(string pushAddress, string account) =>
    new(pushAddress, $"made-up-public-key-{Guid.NewGuid():N}", $"made-up-secret-{Guid.NewGuid():N}", account);

  /// <summary>A made-up token where a push service puts the device's own part of the address.</summary>
  private static string MadeUpToken() => $"made-up-{Guid.NewGuid():N}";
}