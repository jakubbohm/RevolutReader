using System.Net;
using System.Net.Http.Headers;
using RevolutReader.AcceptanceTests.Drivers;
using Shouldly;

namespace RevolutReader.AcceptanceTests.HarnessSelfTests;

/// <summary>
/// Checks of the test harness itself, not of the app (c014 design.md D16; tasks.md 1.1): the fake bank holds the next
/// balance answer until the test releases it, counting the request as received at once, and holds nothing else, so the
/// burst and the caller that stops waiting are lined up by the bank, never by waiting real time. The requests are sent by
/// this test, as the app's bank client sends them (a <c>GET</c> with a bearer token); the balance is made up.
/// </summary>
public sealed class FakeBankSelfTests {
  [Test]
  public async Task A_held_balance_answer_goes_out_only_once_released() {
    using FakeBank fake = FakeBank.Start();
    fake.AnswerBalances(BankDriver.BalancesJson(45.20m, "EUR"));

    fake.HoldTheNextBalanceAnswer();
    Task<HttpStatusCode> held = Get(BalancesOf(fake));
    await fake.WaitUntilTheHeldRequestArrives();

    held.IsCompleted.ShouldBeFalse("the held answer has not gone out");
    fake.BalanceRequestHeadersReceived().Count.ShouldBe(1, "the held request counts as received");

    fake.ReleaseTheHeldAnswer();

    (await held).ShouldBe(HttpStatusCode.OK, "the answer the test set up, once released");
  }

  [Test]
  public async Task Only_the_next_balance_request_is_held_and_every_other_request_is_answered_meanwhile() {
    using FakeBank fake = FakeBank.Start();
    fake.AnswerBalances(BankDriver.BalancesJson(45.20m, "EUR"));

    fake.HoldTheNextBalanceAnswer();
    HttpStatusCode transactions = await Get(new Uri(fake.Address, $"/accounts/{fake.AccountId}/transactions?date_from=2026-11-01"));
    Task<HttpStatusCode> held = Get(BalancesOf(fake));
    await fake.WaitUntilTheHeldRequestArrives();
    HttpStatusCode later = await Get(BalancesOf(fake));

    transactions.ShouldBe(HttpStatusCode.NotFound, "a request for anything else is answered at once, here by WireMock.Net, which has no answer for it");
    later.ShouldBe(HttpStatusCode.OK, "a later balance request is answered while one is held");
    held.IsCompleted.ShouldBeFalse("the held answer has not gone out");

    fake.ReleaseTheHeldAnswer();

    (await held).ShouldBe(HttpStatusCode.OK);
    fake.BalanceRequestHeadersReceived().Count.ShouldBe(2, "the balance requests, counted apart from the transactions request");
    fake.RequestHeadersReceived().Count.ShouldBe(3, "every request");
  }

  /// <summary>The address of the fake bank's account's balances.</summary>
  private static Uri BalancesOf(FakeBank fake) => new(fake.Address, $"/accounts/{fake.AccountId}/balances");

  /// <summary>
  /// A <c>GET</c> of <paramref name="address"/> with a bearer token, as the app's bank client signs its requests (made up
  /// here), from a client of its own; the answer's status.
  /// </summary>
  private static async Task<HttpStatusCode> Get(Uri address) {
    using HttpClient http = new();
    using HttpRequestMessage request = new(HttpMethod.Get, address);
    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "made-up");

    using HttpResponseMessage response = await http.SendAsync(request);

    return response.StatusCode;
  }
}