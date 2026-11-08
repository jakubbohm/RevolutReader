# Entra ID app registration

> What roadmap step M4 set up by hand in Entra ID so that the backend can sign users in ([ADR-0003-sign-in](../adr/0003-sign-in.md), [ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)): the identifiers, why each setting looks the way it does, the commands to rebuild it, and how to check it. The client secret's value is never here: C6 created it ([ADR-0003 § Decision](../adr/0003-sign-in.md#decision), item 4; [below](#the-client-secret-and-the-allowlist-c6)), and only its name and expiry are recorded. The reinstatement guide (D1) and decommissioning (M8) build on this file.
>
> Commands are PowerShell 7. The Microsoft Graph token is always taken with `--subscription` for the owner's personal subscription, which pins both the account and the directory; `--tenant` alone picks the employer account the CLI also holds. Last updated: 2026-11-08 (C6: the redirect URIs under `/api/auth/`, the client secret).

## Identifiers (non-secret)

| What | Value |
|---|---|
| Directory (tenant) | *Default Directory*, `9c9d69e9-f137-467c-8672-d3f091ec4894` (the owner's personal directory, the same as in [azure-prerequisites.md](azure-prerequisites.md)) |
| Display name | `Dad's Card 🙂` (the user's choice; people see it on Microsoft's sign-in screens) |
| Application (client) ID | `7833ec21-abbc-493b-b764-8b74eb3bcaa0` |
| Object ID | `3aa0d49c-bb77-403a-99a0-c9d7ca968639` |
| Supported accounts | personal Microsoft accounts only (`signInAudience: PersonalMicrosoftAccount`) |
| Authority for sign-in | `https://login.microsoftonline.com/consumers/v2.0`; personal-account tokens carry the tenant ID `9188040d-6c67-4c5b-b112-36a304b66dad` |
| Redirect URIs (web platform) | `https://localhost/api/auth/signin-oidc` (Microsoft accepts any port on localhost) and `https://tarjeta-papa.livelyground-53b2e5ad.germanywestcentral.azurecontainerapps.io/api/auth/signin-oidc`, since 2026-11-08 ([C6](#the-sign-in-addresses-under-apiauth-c6)); before that `https://localhost/signin-oidc` and `https://localhost/signout-callback-oidc` |
| Sign-in permissions | Microsoft Graph delegated `openid`, `profile`, `email`; optional claim `email` in the ID token |
| Owner | the owner's account |
| Credentials | one client secret, `RevolutReader C6`, created 2026-11-08, **expires 2027-11-08** ([expiring-approvals.md](expiring-approvals.md)); its value only in Key Vault `kv-revolutreader`, the AppHost's user-secrets and the backup vault ([below](#the-client-secret-and-the-allowlist-c6)) |

## What was set up and why

1. **Personal Microsoft accounts only,** in the owner's existing directory, with no users added to it ([ADR-0004 § Decision](../adr/0004-account-allowlist.md#decision), item 1). This audience brings limits ([Microsoft Learn: validation differences](https://learn.microsoft.com/entra/identity-platform/supported-accounts-validation), 2026-09-25): at most **two client secrets**, no app roles, no query strings or wildcards in redirect URIs, a display name of at most 90 characters, and `api.requestedAccessTokenVersion` set to `2`.
2. **Web-platform redirect URIs on `localhost`, without a port.** Microsoft ignores the port when matching a `localhost` redirect URI ([Microsoft Learn: redirect URI restrictions](https://learn.microsoft.com/entra/identity-platform/reply-url), updated 2026-06-15), so whatever local port C1 and C3 choose works. The paths are ASP.NET Core's OpenID Connect defaults (`CallbackPath`, `SignedOutCallbackPath`); if C6 changes them, it updates the registration. Checked 2026-11-05 against the personal-account sign-in service: `https://localhost:7123/signin-oidc` opened the sign-in page, while an unregistered path on the same port was rejected (`invalid_request`, "redirect_uri … is not valid").
3. **`openid`, `profile`, `email`, plus the optional `email` claim in the ID token.** The allowlist matches the email address ([ADR-0004](../adr/0004-account-allowlist.md)). Microsoft's claim reference lists `email` for personal accounts but does not say plainly that the scope alone delivers it, so the optional claim makes sure it does ([Microsoft Learn: optional claims](https://learn.microsoft.com/entra/identity-platform/optional-claims-reference), updated 2026-08-20). No implicit grant: the backend uses the authorization code flow.
4. **The first sign-in shows Microsoft's consent screen once per person:** the app's name, what it may read (name, email), and Accept. Without publisher verification, which needs a Microsoft Partner Network account, the app is shown as unverified ([Microsoft Learn: Microsoft account](https://learn.microsoft.com/entra/external-id/microsoft-account)). **Seen 2026-11-08** (C6, the owner's first sign-in, which was local): the screen showed the app as unverified and listed the permissions it asks for, which looked as expected; the exact wording was not noted. It does not show again for the same account, so the iPhone check after the merge saw none. The daughter sees it once, at her first sign-in (M5).

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

### The sign-in addresses under /api/auth (C6)

C6 moved the sign-in's return address under `/api/auth/` (c007 design.md D2), so Vite's forwarding, the page fallback and the service worker leave it to the server, and dropped the sign-out return address (sign-out is local only). The two old addresses are replaced by the local and the production one. With `$h` from above (Claude may run it with the owner's go: no secret is involved):

```powershell
$objectId = '3aa0d49c-bb77-403a-99a0-c9d7ca968639'
$patch = @{ web = @{ redirectUris = @(
    'https://localhost/api/auth/signin-oidc',
    'https://tarjeta-papa.livelyground-53b2e5ad.germanywestcentral.azurecontainerapps.io/api/auth/signin-oidc'
) } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Patch -Uri "https://graph.microsoft.com/v1.0/applications/$objectId" -Headers $h -ContentType 'application/json' -Body $patch
(Invoke-RestMethod -Uri "https://graph.microsoft.com/v1.0/applications/${objectId}?`$select=web" -Headers $h).web.redirectUris
```

**Applied on 2026-11-08** by Claude with the owner's go. Read back: exactly the two addresses above. Microsoft's personal-account sign-in page accepts `https://localhost:<any port>/api/auth/signin-oidc` and now refuses the old `/signin-oidc` (`invalid_request`: the redirect_uri is not valid).

### The client secret and the allowlist (C6)

The owner runs it in the owner's own PowerShell 7 window, because it handles secret values (c007 design.md D11). It creates the 12-month client secret (display name `RevolutReader C6`) and asks for the allowlist at a hidden prompt (comma-separated addresses: the owner and the daughter's personal Microsoft account), checks the format, and writes each value to Key Vault `kv-revolutreader` (`SignIn--ClientSecret`, `SignIn--AllowedEmails`), the AppHost's user-secrets (`Parameters:signin-client-secret`, `Parameters:signin-allowed-emails`) and the backup vault (`RevolutReader--AppHost--Parameters--signin-*`, opened for this address only, then closed). Each value goes through a temporary file deleted at once; nothing prints a value. A personal-account registration allows at most two client secrets, so a failed write is re-run line by line in the same window, never the whole block.

```powershell
$sub    = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$id     = '683c44fb-149f-4c9d-8503-0d836e0a1639'      # the AppHost's UserSecretsId
$backup = 'jb-localdev-secrets-copy'
$t   = az account get-access-token --subscription $sub --resource-type ms-graph --query accessToken -o tsv
$h   = @{ Authorization = "Bearer $t" }
$org = Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/organization?$select=id' -Headers $h
if ($org.value[0].id -ne '9c9d69e9-f137-467c-8672-d3f091ec4894') { throw "Wrong directory: $($org.value[0].id)" }

function Set-VaultSecret([string] $vault, [string] $name, [string] $value) {
    $file = New-TemporaryFile
    try {
        Set-Content -LiteralPath $file -Value $value -NoNewline -Encoding utf8NoBOM
        az keyvault secret set --subscription $sub --vault-name $vault --name $name --file $file --encoding utf-8 --output none
        if ($LASTEXITCODE -ne 0) { throw "Writing $name to $vault failed." }
    } finally { Remove-Item -LiteralPath $file }
}

# The allowlist, typed at a hidden prompt and checked before anything is written
$allowed = Read-Host -MaskInput 'Allowed emails, comma-separated'
$entries = @($allowed -split ',' | ForEach-Object { $_.Trim() })
if ($entries.Count -eq 0 -or ($entries | Where-Object { $_ -notmatch '^[^@\s]+@[^@\s]+$' })) { throw 'The allowlist is not a comma-separated list of addresses.' }

# The client secret, 12 months
$body = @{ passwordCredential = @{ displayName = 'RevolutReader C6'; endDateTime = (Get-Date).ToUniversalTime().AddMonths(12).ToString('o') } } | ConvertTo-Json
$cred = Invoke-RestMethod -Method Post -Uri 'https://graph.microsoft.com/v1.0/applications/3aa0d49c-bb77-403a-99a0-c9d7ca968639/addPassword' `
    -Headers $h -ContentType 'application/json' -Body $body

# The app's vault and the AppHost's user-secrets
Set-VaultSecret 'kv-revolutreader' 'SignIn--ClientSecret'  $cred.secretText
Set-VaultSecret 'kv-revolutreader' 'SignIn--AllowedEmails' $allowed
@{ 'Parameters:signin-client-secret' = $cred.secretText; 'Parameters:signin-allowed-emails' = $allowed } |
    ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null

# The backup vault: open for this address, write (retrying while the rule takes effect), close
$ip = ([string](Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15)).Trim()
az keyvault network-rule add --subscription $sub --name $backup --ip-address $ip --output none
az keyvault update --subscription $sub --name $backup --public-network-access Enabled --output none
try {
    foreach ($attempt in 1..4) {
        try {
            Set-VaultSecret $backup 'RevolutReader--AppHost--Parameters--signin-client-secret'  $cred.secretText
            Set-VaultSecret $backup 'RevolutReader--AppHost--Parameters--signin-allowed-emails' $allowed
            break
        } catch { if ($attempt -eq 4) { throw }; Start-Sleep -Seconds 30 }
    }
    az keyvault secret list --subscription $sub --vault-name $backup --query "[?starts_with(name, 'RevolutReader--AppHost--Parameters--signin')].name" --output tsv
} finally {
    az keyvault update --subscription $sub --name $backup --public-network-access Disabled --output none
    az keyvault network-rule remove --subscription $sub --name $backup --ip-address $ip --output none
}

# Names only, and the secret's expiry (not secret)
az keyvault secret list --subscription $sub --vault-name kv-revolutreader --query "[?starts_with(name, 'SignIn--')].name" --output tsv
(Get-Content -Raw (Join-Path $env:APPDATA "Microsoft/UserSecrets/$id/secrets.json") | ConvertFrom-Json).PSObject.Properties.Name | Where-Object { $_ -like 'Parameters:signin-*' }
"Client secret expires $($cred.endDateTime)"
$cred = $null; $allowed = $null
```

**Changing the allowlist later** (adding or removing a person): run only the allowlist lines with the three writes of `$allowed`, then restart the app (the list is read at start; in Azure a new value reaches the app within 30 minutes, [deployment.md § The sign-in's values and settings](deployment.md#the-sign-ins-values-and-settings-c6)). **Renewing the client secret** (12 months, [expiring-approvals.md](expiring-approvals.md)): the secret lines only; then remove the old secret from the registration.

**Run on 2026-11-08** by the owner. Claude checked names only: the registration lists one secret, `RevolutReader C6`, created 2026-11-08 11:00:59 UTC and expiring 2027-11-08 11:00:59 UTC; Key Vault `kv-revolutreader` holds `SignIn--ClientSecret` and `SignIn--AllowedEmails`; the user-secrets hold both `Parameters:signin-*` keys; the backup vault holds both `RevolutReader--AppHost--Parameters--signin-*` names and was closed again. The allowlist has two entries.

## Checks

```powershell
$app = Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/applications/3aa0d49c-bb77-403a-99a0-c9d7ca968639?$select=displayName,appId,signInAudience,web,passwordCredentials' -Headers $h
$app.displayName; $app.signInAudience; $app.web.redirectUris; "secrets: $($app.passwordCredentials.Count)"

# The personal-account sign-in page accepts the registration and a localhost redirect URI on any port
$q = 'client_id=7833ec21-abbc-493b-b764-8b74eb3bcaa0&response_type=code&scope=openid%20profile%20email&response_mode=form_post&state=x&nonce=x&redirect_uri=' + [uri]::EscapeDataString('https://localhost:7123/api/auth/signin-oidc')
$r = Invoke-WebRequest -Uri "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?$q" -SkipHttpErrorCheck
[regex]::Match($r.Content, '<title>([^<]*)</title>').Groups[1].Value   # expected: Sign in to your Microsoft account
```

## Removing it (M8)

Delete the registration: `Invoke-RestMethod -Method Delete -Uri 'https://graph.microsoft.com/v1.0/applications/3aa0d49c-bb77-403a-99a0-c9d7ca968639' -Headers $h`. It goes to the directory's deleted items for 30 days and can be restored from there. Its client secret goes with it.
