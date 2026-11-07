# Local secrets

> The secrets on the owner's machine that local runs and the explicit bank checks read (roadmap step C5): what they are, how they are set from the owner's files, how they are backed up to the owner's personal Key Vault and how they come back on a new machine. The rules behind it: [configuration.md § Local development and tests](../conventions/configuration.md#local-development-and-tests) and c004 design.md D6. Production values are in Key Vault `kv-revolutreader` instead ([deployment.md § Guided task](deployment.md#guided-task-the-enable-banking-values-into-key-vault)).
>
> Commands are PowerShell 7, run from the root of the **main checkout** (`D:\source\jakubbohm\RevolutReader`), where the gitignored `secrets/` folders of the spikes are. User-secrets are per machine, so every checkout and worktree on the machine shares them. **Nothing here prints a value:** keys go in from their files, and the checks list names only. Last updated: 2026-11-07 (C5).

## What is stored

All of them sit in the **AppHost's** user-secrets (its `UserSecretsId` is `683c44fb-149f-4c9d-8503-0d836e0a1639`), the only place local secrets live. The AppHost hands the `Parameters:*` values to the API as Aspire parameters; it declares no `RealAccountCheck:*` parameter, so only Check 2 reads those (c004 design.md D7).

| User-secrets key | Read by | Value, from the owner's machine | Copy in `jb-localdev-secrets-copy` |
|---|---|---|---|
| `Parameters:enablebanking-application-id` | `aspire start`, Check 1 | the sandbox application ID `b4780885-a339-48bd-b6b3-067e5056d2ad` ([mock spike § Identifiers](../../spikes/enable-banking-mock/README.md)) | `RevolutReader--AppHost--Parameters--enablebanking-application-id` |
| `Parameters:enablebanking-private-key` | `aspire start`, Check 1 | the text of `spikes/enable-banking/secrets/b4780885-a339-48bd-b6b3-067e5056d2ad.pem` | `RevolutReader--AppHost--Parameters--enablebanking-private-key` |
| `Parameters:enablebanking-session-id` | `aspire start`, Check 1 | `session_id` in `spikes/enable-banking-mock/secrets/session.json` (the Mock ASPSP session, valid until 2027-05-05) | `RevolutReader--AppHost--Parameters--enablebanking-session-id` |
| `Parameters:enablebanking-account-id` | `aspire start`, Check 1 | the one entry of `account_uids` in the same file (the account "RevolutReader C5 Test") | `RevolutReader--AppHost--Parameters--enablebanking-account-id` |
| `RealAccountCheck:ApplicationId` | Check 2 only | the production application ID `469fb438-ada6-4831-9498-70a1890097d6` ([spike § Identifiers](../../spikes/enable-banking/README.md#identifiers-non-secret)) | `RevolutReader--AppHost--RealAccountCheck--ApplicationId` |
| `RealAccountCheck:PrivateKey` | Check 2 only | the text of `spikes/enable-banking/secrets/469fb438-ada6-4831-9498-70a1890097d6.pem` | `RevolutReader--AppHost--RealAccountCheck--PrivateKey` |
| `RealAccountCheck:SessionId` | Check 2 only | `session_id` in `spikes/enable-banking/secrets/session.json` (the real account's session) | `RevolutReader--AppHost--RealAccountCheck--SessionId` |
| `RealAccountCheck:AccountId` | Check 2 only | the one entry of `account_uids` in the same file | `RevolutReader--AppHost--RealAccountCheck--AccountId` |

The AppHost's own keys (`AppHost:*`, `Aspire:*`) are created by Aspire and are not backed up: Aspire creates them again.

**The backup vault** `jb-localdev-secrets-copy` (resource group `Shared`, the owner's subscription; Azure roles) keeps a copy of every local secret, so they survive a new or reinstalled laptop. All the owner's projects share it; the app and the tests never read it. Names are `RevolutReader--<store>--<key>`, with each `:` of the key written as `--`, because Key Vault names allow only letters, digits and dashes. The mapping is reversible, so restoring is mechanical. Writing to it needs the owner's Key Vault Secrets Officer role on it (assigned 2026-11-06) and, under CLAUDE.md, the owner's go.

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

The owner runs it after § 1 or § 2 (an Azure write: CLAUDE.md asks for the owner's go, and Claude Code's permission check blocks Claude's secret writes anyway). It copies every `Parameters:enablebanking-*` and `RealAccountCheck:*` key that the user-secrets hold. Each value goes through a temporary file that is deleted at once, so it never appears on a command line.

```powershell
$sub   = '7811bd13-d9ae-46bb-9355-3e3d885e544e'
$vault = 'jb-localdev-secrets-copy'
$id    = '683c44fb-149f-4c9d-8503-0d836e0a1639'

$store = Get-Content -Raw (Join-Path $env:APPDATA "Microsoft/UserSecrets/$id/secrets.json") | ConvertFrom-Json -AsHashtable
$keys  = $store.Keys | Where-Object { $_ -like 'Parameters:enablebanking-*' -or $_ -like 'RealAccountCheck:*' }

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

Never `dotnet user-secrets list`: it prints the values.

## 5. Restore on a new machine

Every `RevolutReader--AppHost--*` secret goes back into the AppHost's user-secrets. Reading the vault changes nothing in Azure. Each value is read as JSON, so the key's line breaks survive.

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

- **2026-11-07:** § 1 run by Claude in C5's unattended run (the user's go of the evening before); § 4's local listing shows the four `Parameters:enablebanking-*` names. **For the owner:** § 3 (the backup copies), and § 2 with § 3 again before Check 2.
