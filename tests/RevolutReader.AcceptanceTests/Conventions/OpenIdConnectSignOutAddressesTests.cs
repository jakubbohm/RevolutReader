using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The OpenID Connect handler's own sign-out addresses do nothing (c007 design.md D2, D4). Every sign-in address sits under
/// <c>/api/auth/</c>, and there is no Microsoft sign-out address: signing out ends only the app's login, through
/// <c>POST /api/auth/logout</c>. ASP.NET's handler listens by default at <c>/signout-oidc</c> (Microsoft's front-channel
/// sign-out, answered on any GET or form POST) and <c>/signout-callback-oidc</c>, inside the authentication step of every
/// request. Left on, any other app on the shared hosting domain, which counts as the same site (D4), could sign Lucie out
/// with an image. So a request to either address, from wherever it comes, leaves the login alone, and both are page
/// addresses like any other: they answer the app's page. A rule, not a scenario: the spec names no such address.
/// </summary>
public sealed class OpenIdConnectSignOutAddressesTests : AcceptanceTest {
  /// <summary>The handler's default front-channel sign-out address (<c>OpenIdConnectOptions.RemoteSignOutPath</c>).</summary>
  private const string REMOTE_SIGN_OUT = "/signout-oidc";

  /// <summary>The handler's default return address after a Microsoft sign-out (<c>OpenIdConnectOptions.SignedOutCallbackPath</c>).</summary>
  private const string SIGNED_OUT_CALLBACK = "/signout-callback-oidc";

  [Test]
  public async Task Another_apps_image_of_the_handlers_sign_out_address_leaves_the_user_signed_in() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    await SignInDriver.LoadAsAnotherAppsImage(REMOTE_SIGN_OUT);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie), "Lucie is still signed in");
  }

  [Test]
  public async Task A_cross_site_form_post_to_the_handlers_sign_out_address_leaves_the_user_signed_in() {
    await SignIn.HasSignedIn(Visitor.Lucie);

    await SignInDriver.PostFormFromAnotherSite(REMOTE_SIGN_OUT);

    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.SignedInAs(Visitor.Lucie), "Lucie is still signed in");
  }

  [Test]
  [Arguments(REMOTE_SIGN_OUT)]
  [Arguments(SIGNED_OUT_CALLBACK)]
  public async Task The_handlers_sign_out_addresses_answer_the_apps_page(string address) =>
    (await SignInDriver.OpenPageAddress(address)).ShouldBe(PageAnswer.TheApp, $"{address} answers the app's page, as every page address does");
}