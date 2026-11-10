using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using RevolutReader.Api.Push;
using RevolutReader.Api.SignIn;
using RevolutReader.UnitTests.Push;

namespace RevolutReader.IntegrationTests.Wiring.Push;

/// <summary>
/// An app copy for the subscription endpoint's own tests (c011 design.md D9), on the shared <see cref="MadeUpSettings"/>,
/// in environment <c>Production</c>, with <see cref="MessageEndpointApp.ALLOWED_ACCOUNT"/> as the
/// allowlist and the known push services <c>appsettings.json</c> declares (no loopback service among them). Two things
/// differ from a real run, neither of them the endpoint's:
/// <list type="bullet">
/// <item>The device store is the in-memory fake (<see cref="Devices"/>), which the store's contract tests hold to the
/// Table adapter's behaviour, so a test sees what was stored without Docker.</item>
/// <item>Sign-in is the app's own login cookie, made with the app copy's own cookie settings and keys for the account
/// given (<see cref="SignedInAs"/>), instead of a round trip to Microsoft (the acceptance tests walk that one). The
/// cookie handler, the <c>AllowedUser</c> policy and the allowlist are the app's.</item>
/// </list>
/// Requests as the app's module sends them, minus the browser's fetch metadata: no <c>Sec-Fetch-Site</c> and no
/// <c>Origin</c>, which the rule against writes from other sites lets through (c007 design.md D4).
/// </summary>
internal sealed class SubscriptionEndpointApp : WebApplicationFactory<Program> {
  /// <summary>The subscription endpoint (D9).</summary>
  public const string SUBSCRIPTION = "/api/push/subscription";

  private const string TABLES_CONNECTION = "ConnectionStrings:tables";
  private const string MADE_UP_TABLES_CONNECTION = "UseDevelopmentStorage=true";

  /// <summary>The devices this app copy stored.</summary>
  public InMemoryPushDeviceStore Devices { get; } = new();

  /// <summary>A client whose every request carries a login cookie for <paramref name="account"/>; it keeps no cookie the app sets.</summary>
  public HttpClient SignedInAs(string account) {
    ArgumentException.ThrowIfNullOrEmpty(account);

    HttpClient client = CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, AllowAutoRedirect = false });
    client.DefaultRequestHeaders.Add("Cookie", $"{SignInCookies.SESSION}={LoginCookie(account)}");

    return client;
  }

  protected override void ConfigureWebHost(IWebHostBuilder builder) {
    builder.UseEnvironment(Environments.Production);
    builder.UseSetting(TABLES_CONNECTION, MADE_UP_TABLES_CONNECTION);
    builder.ConfigureAppConfiguration((_, configuration) =>
      configuration.AddInMemoryCollection(MadeUpSettings.For(MessageEndpointApp.ALLOWED_ACCOUNT)));
    builder.ConfigureTestServices(services => {
      services.RemoveAll<IPushDeviceStore>();
      services.AddSingleton<IPushDeviceStore>(Devices);
    });
  }

  /// <summary>
  /// The login cookie's value for <paramref name="account"/>, as the app writes it after a sign-in: a ticket of the cookie
  /// scheme whose login holds the <c>email</c> claim, protected with the app copy's own cookie settings.
  /// </summary>
  private string LoginCookie(string account) {
    CookieAuthenticationOptions cookie = Services
      .GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>()
      .Get(CookieAuthenticationDefaults.AuthenticationScheme);
    ClaimsIdentity login = new([new Claim(JwtRegisteredClaimNames.Email, account)], CookieAuthenticationDefaults.AuthenticationScheme);

    return cookie.TicketDataFormat.Protect(new AuthenticationTicket(new ClaimsPrincipal(login), CookieAuthenticationDefaults.AuthenticationScheme));
  }
}