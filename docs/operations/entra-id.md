# Entra ID app registration

> What roadmap step M4 set up by hand in Entra ID so that the backend can sign users in ([ADR-0003-sign-in](../adr/0003-sign-in.md), [ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)): the identifiers, why each setting looks the way it does, the commands to rebuild it, and how to check it. The client secret is not here: C6 creates it ([ADR-0003 § Decision](../adr/0003-sign-in.md#decision), item 4). The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7. The Microsoft Graph token is always taken with `--subscription` for the owner's personal subscription, which pins both the account and the directory; `--tenant` alone picks the employer account the CLI also holds. Last updated: 2026-11-05 (M4).

## Identifiers (non-secret)

| What | Value |
|---|---|
| Directory (tenant) | *Default Directory*, `9c9d69e9-f137-467c-8672-d3f091ec4894` (the owner's personal directory, the same as in [azure-prerequisites.md](azure-prerequisites.md)) |
| Display name | `Dad's Card 🙂` (the user's choice; people see it on Microsoft's sign-in screens) |
| Application (client) ID | `7833ec21-abbc-493b-b764-8b74eb3bcaa0` |
| Object ID | `3aa0d49c-bb77-403a-99a0-c9d7ca968639` |
| Supported accounts | personal Microsoft accounts only (`signInAudience: PersonalMicrosoftAccount`) |
| Authority for sign-in | `https://login.microsoftonline.com/consumers/v2.0`; personal-account tokens carry the tenant ID `9188040d-6c67-4c5b-b112-36a304b66dad` |
| Redirect URIs (web platform) | `https://localhost/signin-oidc`, `https://localhost/signout-callback-oidc`; production ones added after C4 ([below](#adding-the-production-redirect-uris)) |
| Sign-in permissions | Microsoft Graph delegated `openid`, `profile`, `email`; optional claim `email` in the ID token |
| Owner | the owner's account |
| Credentials | none yet; C6 adds the 12-month client secret |

## What was set up and why

1. **Personal Microsoft accounts only,** in the owner's existing directory, with no users added to it ([ADR-0004 § Decision](../adr/0004-account-allowlist.md#decision), item 1). This audience brings limits ([Microsoft Learn: validation differences](https://learn.microsoft.com/entra/identity-platform/supported-accounts-validation), 2026-09-25): at most **two client secrets**, no app roles, no query strings or wildcards in redirect URIs, a display name of at most 90 characters, and `api.requestedAccessTokenVersion` set to `2`.
2. **Web-platform redirect URIs on `localhost`, without a port.** Microsoft ignores the port when matching a `localhost` redirect URI ([Microsoft Learn: redirect URI restrictions](https://learn.microsoft.com/entra/identity-platform/reply-url), updated 2026-06-15), so whatever local port C1 and C3 choose works. The paths are ASP.NET Core's OpenID Connect defaults (`CallbackPath`, `SignedOutCallbackPath`); if C6 changes them, it updates the registration. Checked 2026-11-05 against the personal-account sign-in service: `https://localhost:7123/signin-oidc` opened the sign-in page, while an unregistered path on the same port was rejected (`invalid_request`, "redirect_uri … is not valid").
3. **`openid`, `profile`, `email`, plus the optional `email` claim in the ID token.** The allowlist matches the email address ([ADR-0004](../adr/0004-account-allowlist.md)). Microsoft's claim reference lists `email` for personal accounts but does not say plainly that the scope alone delivers it, so the optional claim makes sure it does ([Microsoft Learn: optional claims](https://learn.microsoft.com/entra/identity-platform/optional-claims-reference), updated 2026-08-20). No implicit grant: the backend uses the authorization code flow.
4. **The first sign-in shows Microsoft's consent screen once per person:** the app's name, what it may read (name, email), and Accept. Without publisher verification, which needs a Microsoft Partner Network account, the app is shown as unverified ([Microsoft Learn: Microsoft account](https://learn.microsoft.com/entra/external-id/microsoft-account)). Exactly what a personal account sees is confirmed in C6's iPhone check.

## Commands

The full setup, in order. Creating it twice makes a second registration; check first that none exists.

```powershell
$sub = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$t   = az account get-access-token --subscription $sub --resource-type ms-graph --query accessToken -o tsv
$h   = @{ Authorization = "Bearer $t" }

# Stop unless the token is for the owner's personal directory
$org = Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/organization?$select=id' -Headers $h
if ($org.value[0].id -ne '9c9d69e9-f137-467c-8672-d3f091ec4894') { throw "Wrong directory: $($org.value[0].id)" }

# 1. The registration (Graph scope IDs: openid, profile, email)
$body = @{
    displayName            = "Dad's Card " + [char]::ConvertFromUtf32(0x1F642)
    signInAudience         = 'PersonalMicrosoftAccount'
    api                    = @{ requestedAccessTokenVersion = 2 }
    web                    = @{
        redirectUris          = @('https://localhost/signin-oidc', 'https://localhost/signout-callback-oidc')
        implicitGrantSettings = @{ enableIdTokenIssuance = $false; enableAccessTokenIssuance = $false }
    }
    requiredResourceAccess = @(@{
        resourceAppId  = '00000003-0000-0000-c000-000000000000'
        resourceAccess = @(
            @{ id = '37f7f235-527c-4136-accd-4a02d197296e'; type = 'Scope' },
            @{ id = '14dad69e-099b-42c9-810b-d002981feec1'; type = 'Scope' },
            @{ id = '64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0'; type = 'Scope' })
    })
    optionalClaims         = @{ idToken = @(@{ name = 'email'; essential = $false }) }
    notes                  = 'RevolutReader sign-in (github.com/jakubbohm/RevolutReader), see docs/operations/entra-id.md'
} | ConvertTo-Json -Depth 10
$app = Invoke-RestMethod -Method Post -Uri 'https://graph.microsoft.com/v1.0/applications' -Headers $h `
    -ContentType 'application/json; charset=utf-8' -Body $body
$app | Select-Object displayName, appId, id

# 2. The owner's account as the registration's owner
$me  = Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/me?$select=id' -Headers $h
$ref = @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$($me.id)" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/applications/$($app.id)/owners/`$ref" -Headers $h `
    -ContentType 'application/json' -Body $ref
```

A rebuilt registration gets a new client ID: update the table above and the app's configuration.

### Adding the production redirect URIs

Once C4 gives the app its URL (`$appUrl`, e.g. `https://<app>.<environment>.germanywestcentral.azurecontainerapps.io`), with `$h` from above:

```powershell
$objectId = '3aa0d49c-bb77-403a-99a0-c9d7ca968639'
$current  = (Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/applications/${objectId}?`$select=web" -Headers $h).web.redirectUris
$patch    = @{ web = @{ redirectUris = @($current + "$appUrl/signin-oidc" + "$appUrl/signout-callback-oidc" | Select-Object -Unique) } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Patch -Uri "https://graph.microsoft.com/v1.0/applications/$objectId" -Headers $h -ContentType 'application/json' -Body $patch
```

Then add them to the table above.

## Checks

```powershell
$app = Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/applications/3aa0d49c-bb77-403a-99a0-c9d7ca968639?$select=displayName,appId,signInAudience,web,passwordCredentials' -Headers $h
$app.displayName; $app.signInAudience; $app.web.redirectUris; "secrets: $($app.passwordCredentials.Count)"

# The personal-account sign-in page accepts the registration and a localhost redirect URI on any port
$q = 'client_id=7833ec21-abbc-493b-b764-8b74eb3bcaa0&response_type=code&scope=openid%20profile%20email&response_mode=form_post&state=x&nonce=x&redirect_uri=' + [uri]::EscapeDataString('https://localhost:7123/signin-oidc')
$r = Invoke-WebRequest -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?$q" -SkipHttpErrorCheck
[regex]::Match($r.Content, '<title>([^<]*)</title>').Groups[1].Value   # expected: Sign in to your Microsoft account
```

## Removing it (M8)

Delete the registration: `Invoke-RestMethod -Method Delete -Uri 'https://graph.microsoft.com/v1.0/applications/3aa0d49c-bb77-403a-99a0-c9d7ca968639' -Headers $h`. It goes to the directory's deleted items for 30 days and can be restored from there. Its client secret goes with it.
