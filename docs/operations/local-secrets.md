# Local secrets

> The secrets on the owner's machine that local runs and the explicit bank checks read (roadmap steps C5, C6 and C8a): what they are, how they are set from the owner's files, how they are backed up to the owner's personal Key Vault and how they come back on a new machine. The rules behind it: [configuration.md § Local development and tests](../conventions/configuration.md#local-development-and-tests) and c004 design.md D6. Production values are in Key Vault `kv-revolutreader` instead ([deployment.md § Guided task](deployment.md#guided-task-the-enable-banking-values-into-key-vault)).
>
> Commands are PowerShell 7, run from the root of the **main checkout** (`D:\source\jakubbohm\RevolutReader`), where the gitignored `secrets/` folders of the spikes are. User-secrets are per machine, so every checkout and worktree on the machine shares them. **Nothing here prints a value:** keys go in from their files, and the checks list names only. Last updated: 2026-11-09 (C8a: the three push keys).

## What is stored

All of them sit in the **AppHost's** user-secrets (its `UserSecretsId` is `683c44fb-149f-4c9d-8503-0d836e0a1639`), the only place local secrets live. The AppHost hands the `Parameters:*` values to the API as Aspire parameters; it declares no `RealAccountCheck:*` parameter, so only Check 2 reads those (c004 design.md D7).

| User-secrets key | Read by | Value, from the owner's machine | Copy in `jb-localdev-secrets-copy` |
|---|---|---|---|
| `Parameters:enablebanking-application-id` | `aspire start`, Check 1 | the sandbox application ID `b4780885-a339-48bd-b6b3-067e5056d2ad` ([mock spike § Identifiers](../../spikes/enable-banking-mock/README.md)) | `RevolutReader--AppHost--Parameters--enablebanking-application-id` |
| `Parameters:enablebanking-private-key` | `aspire start`, Check 1 | the text of `spikes/enable-banking/secrets/b4780885-a339-48bd-b6b3-067e5056d2ad.pem` | `RevolutReader--AppHost--Parameters--enablebanking-private-key` |
| `Parameters:enablebanking-session-id` | `aspire start`, Check 1 | `session_id` in `spikes/enable-banking-mock/secrets/session.json` (the Mock ASPSP session, valid until 2027-05-05) | `RevolutReader--AppHost--Parameters--enablebanking-session-id` |
| `Parameters:enablebanking-account-id` | `aspire start`, Check 1 | the one entry of `account_uids` in the same file (the account "RevolutReader C5 Test") | `RevolutReader--AppHost--Parameters--enablebanking-account-id` |
| `Parameters:signin-client-secret` | `aspire start` (C6) | the Entra registration's client secret `RevolutReader C6`, created by [entra-id.md § The client secret and the allowlist](entra-id.md#the-client-secret-and-the-allowlist-c6), which writes it here, to Key Vault and to the backup vault at once; no file holds it (expires 2027-11-08) | `RevolutReader--AppHost--Parameters--signin-client-secret` |
| `Parameters:signin-allowed-emails` | `aspire start` (C6) | the allowlist, typed by the owner at that block's hidden prompt: the comma-separated personal Microsoft accounts allowed in (the same list as production, [configuration.md](../conventions/configuration.md)) | `RevolutReader--AppHost--Parameters--signin-allowed-emails` |
| `Parameters:push-vapid-public-key` | `aspire start` (C8a) | the laptop's own VAPID public key, never production's (c011 design.md D5), made by the laptop variant of [deployment.md § Guided task: the push keys](deployment.md#guided-task-the-push-keys), which writes it here and to the backup vault at once; no file holds it | `RevolutReader--AppHost--Parameters--push-vapid-public-key` |
| `Parameters:push-vapid-private-key` | `aspire start` (C8a) | its private half, from the same block | `RevolutReader--AppHost--Parameters--push-vapid-private-key` |
| `Parameters:push-message-key` | `aspire start` (C8a) | the laptop's own message key, 32 random bytes, from the same block | `RevolutReader--AppHost--Parameters--push-message-key` |
| `RealAccountCheck:ApplicationId` | Check 2 only | the production application ID `469fb438-ada6-4831-9498-70a1890097d6` ([spike § Identifiers](../../spikes/enable-banking/README.md#identifiers-non-secret)) | `RevolutReader--AppHost--RealAccountCheck--ApplicationId` |
| `RealAccountCheck:PrivateKey` | Check 2 only | the text of `spikes/enable-banking/secrets/469fb438-ada6-4831-9498-70a1890097d6.pem` | `RevolutReader--AppHost--RealAccountCheck--PrivateKey` |
| `RealAccountCheck:SessionId` | Check 2 only | `session_id` in `spikes/enable-banking/secrets/session.json` (the real account's session) | `RevolutReader--AppHost--RealAccountCheck--SessionId` |
| `RealAccountCheck:AccountId` | Check 2 only | the one entry of `account_uids` in the same file | `RevolutReader--AppHost--RealAccountCheck--AccountId` |

The AppHost's own keys (`AppHost:*`, `Aspire:*`) are created by Aspire and are not backed up: Aspire creates them again.

**The backup vault** `jb-localdev-secrets-copy` (resource group `Shared`, the owner's subscription; Azure roles) keeps a copy of every local secret, so they survive a new or reinstalled laptop. All the owner's projects share it; the app and the tests never read it. Names are `RevolutReader--<store>--<key>`, with each `:` of the key written as `--`, because Key Vault names allow only letters, digits and dashes. The mapping is reversible, so restoring is mechanical. Writing to it needs the owner's Key Vault Secrets Officer role on it (assigned 2026-11-06) and, under CLAUDE.md, the owner's go.

**The backup vault stays closed to the internet** (public network access off, checked 2026-11-07), because nothing reads it except the owner, now and then. So every step below that touches it (§ 3, the vault half of § 4, and § 5) runs between [opening and closing it](#opening-and-closing-the-backup-vault). The app's own vault, `kv-revolutreader`, is different: the running app reads it, so it stays open, guarded by its roles ([deployment.md § Identifiers](deployment.md#identifiers-non-secret)).

### Opening and closing the backup vault

Opening lets in only your current public IP address; closing removes it again. Both are changes in Azure, so the owner runs them.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$vault = 'jb-localdev-secrets-copy'
$ip    = ([string](Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15)).Trim()

# Open: allow this address, then turn public access on (the vault's default stays "deny everything else")
az keyvault network-rule add --subscription $sub --name $vault --ip-address $ip --output none
az keyvault update --subscription $sub --name $vault --public-network-access Enabled --output none
```

Run the step, in the same window (it reuses `$sub`, `$vault` and `$ip`). If its first command is still refused, wait a minute and run it again. Then close:

```powershell
# Close: public access off, then forget the address
az keyvault update --subscription $sub --name $vault --public-network-access Disabled --output none
az keyvault network-rule remove --subscription $sub --name $vault --ip-address $ip --output none
```

## 1. The sandbox values into the user-secrets

Run whenever the Mock ASPSP session is renewed ([expiring-approvals.md § 4](expiring-approvals.md#4-mock-aspsp-session-local-development)) or on a new machine without a backup. The values go in as JSON on the standard input, so none of them appears on a command line.

```powershell
$id     = '683c44fb-149f-4c9d-8503-0d836e0a1639'    # the AppHost's UserSecretsId
$appId  = 'b4780885-a339-48bd-b6b3-067e5056d2ad'    # the sandbox application (public)

$session = Get-Content -Raw 'spikes/enable-banking-mock/secrets/session.json' | ConvertFrom-Json
$uids    = @($session.account_uids | Where-Object { $_ })
if ($uids.Count -ne 1) { throw "Expected exactly one account UID in session.json, found $($uids.Count)." }
if (-not $session.session_id) { throw 'No session_id in session.json.' }

@{
  'Parameters:enablebanking-application-id' = $appId
  'Parameters:enablebanking-private-key'    = Get-Content -Raw "spikes/enable-banking/secrets/$appId.pem"
  'Parameters:enablebanking-session-id'     = $session.session_id
  'Parameters:enablebanking-account-id'     = $uids[0]
} | ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null
```

`dotnet user-secrets set` with JSON on its input adds or replaces those keys and keeps the others. Then list the names ([§ 4](#4-check-names-only)).

## 2. Check 2's values into the user-secrets

Only for Check 2, the one-off read of the real account (c004 tasks.md 39.2). The owner runs it.

```powershell
$id     = '683c44fb-149f-4c9d-8503-0d836e0a1639'
$appId  = '469fb438-ada6-4831-9498-70a1890097d6'    # the production application (public)

$session = Get-Content -Raw 'spikes/enable-banking/secrets/session.json' | ConvertFrom-Json
$uids    = @($session.account_uids | Where-Object { $_ })
if ($uids.Count -ne 1) { throw "Expected exactly one account UID in session.json, found $($uids.Count)." }
if (-not $session.session_id) { throw 'No session_id in session.json.' }

@{
  'RealAccountCheck:ApplicationId' = $appId
  'RealAccountCheck:PrivateKey'    = Get-Content -Raw "spikes/enable-banking/secrets/$appId.pem"
  'RealAccountCheck:SessionId'     = $session.session_id
  'RealAccountCheck:AccountId'     = $uids[0]
} | ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null
```

## 3. Back up to the vault

The owner runs it after § 1 or § 2 (an Azure write: CLAUDE.md asks for the owner's go, and Claude Code's permission check blocks Claude's secret writes anyway), between [opening and closing the vault](#opening-and-closing-the-backup-vault). It copies every `Parameters:*` and `RealAccountCheck:*` key that the user-secrets hold (since C6 the sign-in's two and since C8a the three push keys as well; the blocks that create them already back them up). Each value goes through a temporary file that is deleted at once, so it never appears on a command line.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$vault = 'jb-localdev-secrets-copy'
$id    = '683c44fb-149f-4c9d-8503-0d836e0a1639'

$store = Get-Content -Raw (Join-Path $env:APPDATA "Microsoft/UserSecrets/$id/secrets.json") | ConvertFrom-Json -AsHashtable
$keys  = $store.Keys | Where-Object { $_ -like 'Parameters:*' -or $_ -like 'RealAccountCheck:*' }

foreach ($key in $keys) {
  $name = 'RevolutReader--AppHost--' + ($key -replace ':', '--')
  $file = New-TemporaryFile
  try {
    Set-Content -LiteralPath $file -Value $store[$key] -NoNewline -Encoding utf8NoBOM
    az keyvault secret set --subscription $sub --vault-name $vault --name $name --file $file --encoding utf-8 --output none
  }
  finally { Remove-Item -LiteralPath $file }
}

az keyvault secret list --subscription $sub --vault-name $vault --query "[?starts_with(name, 'RevolutReader--')].name" --output tsv
```

## 4. Check, names only

```powershell
$id = '683c44fb-149f-4c9d-8503-0d836e0a1639'
(Get-Content -Raw (Join-Path $env:APPDATA "Microsoft/UserSecrets/$id/secrets.json") | ConvertFrom-Json).PSObject.Properties.Name | Sort-Object

az keyvault secret list --subscription '7811bd13-d9ae-46bb-9355-3e3d885e544e' --vault-name 'jb-localdev-secrets-copy' `
    --query "[?starts_with(name, 'RevolutReader--')].name" --output tsv
```

The vault listing needs the vault open ([above](#opening-and-closing-the-backup-vault)); the first command does not. Never `dotnet user-secrets list`: it prints the values.

## 5. Restore on a new machine

Every `RevolutReader--AppHost--*` secret goes back into the AppHost's user-secrets, between [opening and closing the vault](#opening-and-closing-the-backup-vault). Reading the secrets changes nothing in Azure. Each value is read as JSON, so the key's line breaks survive.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$vault = 'jb-localdev-secrets-copy'
$id    = '683c44fb-149f-4c9d-8503-0d836e0a1639'

$names = az keyvault secret list --subscription $sub --vault-name $vault `
    --query "[?starts_with(name, 'RevolutReader--AppHost--')].name" --output tsv

$values = @{}
foreach ($name in $names) {
  $key = ($name -replace '^RevolutReader--AppHost--', '') -replace '--', ':'
  $values[$key] = az keyvault secret show --subscription $sub --vault-name $vault --name $name --query value --output json | ConvertFrom-Json
}
$values | ConvertTo-Json -Compress | dotnet user-secrets set --id $id | Out-Null
```

Then list the names (§ 4) and run `aspire start`.

## Done

- **2026-11-07:** § 1 run by Claude in C5's unattended run (the user's go of the evening before); § 4's local listing shows the four `Parameters:enablebanking-*` names. Then the owner ran § 3 (the backup copies), § 2 and § 3 again, and Check 2.
- **2026-11-08 (C6):** the owner ran [entra-id.md § The client secret and the allowlist](entra-id.md#the-client-secret-and-the-allowlist-c6); Claude checked by name: the user-secrets hold both `Parameters:signin-*` keys (the Enable Banking keys untouched), the backup vault both `RevolutReader--AppHost--Parameters--signin-*` names, and the vault is closed again (public access off, no IP rule). The local sign-in was checked in a browser the same day.
