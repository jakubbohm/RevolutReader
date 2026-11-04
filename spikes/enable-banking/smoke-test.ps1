#Requires -Version 7.5
# Spike step 6: smoke test with the account holder present (ADR-0001-bank-data-access § Decision, item 1).
# Reads the balance more times than Revolut allows without the user present (4 a day per endpoint), plus
# one read of recent transactions, all with the owner's real PSU headers. If every read succeeds, reads
# made with the user present are not capped at 4 a day.
# Prints and records only status codes, error codes, balance types and counts: no amounts, no identifiers.
# The owner's public IP is fetched from api.ipify.org, sent only to Enable Banking, never printed or saved.
#   pwsh -NoProfile -File spikes/enable-banking/smoke-test.ps1

param(
    [int] $BalanceReads = 6,
    [int] $RecentDays = 7
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/eb-client.ps1"

$sessionPath = Join-Path $PSScriptRoot 'secrets/session.json'
$stored = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -DateKind String
$uid = @($stored.account_uids | Where-Object { $_ })[0]
if (-not $uid) { throw "No account UID in $sessionPath." }

$ip = ([string](Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15)).Trim()
if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Unexpected answer from api.ipify.org (expected an IPv4 address).' }
$psuHeaders = @{
    'Psu-Ip-Address' = $ip
    'Psu-User-Agent' = "RevolutReader-spike/1.0 PowerShell/$($PSVersionTable.PSVersion)"
}

function Get-ErrorCode($Result) {
    if ($Result.Body -is [psobject] -and $Result.Body.error) { $Result.Body.error } else { '-' }
}

# 1. Balance reads
$balanceResults = [System.Collections.Generic.List[object]]::new()
$balanceTypes = @()
foreach ($i in 1..$BalanceReads) {
    $r = Invoke-EbApi -Path "/accounts/$uid/balances" -Headers $psuHeaders
    $balanceResults.Add([ordered]@{ read = $i; http = $r.Status; error = (Get-ErrorCode $r) })
    if ($r.Status -eq 200 -and -not $balanceTypes) {
        $balanceTypes = @($r.Body.balances | ForEach-Object { "$($_.balance_type) ($($_.name))" })
    }
    Write-Host "Balance read $i of ${BalanceReads}: HTTP $($r.Status) $(if ($r.Status -ne 200) { Get-ErrorCode $r })"
}

# 2. Recent transactions
$dateFrom = [DateTimeOffset]::UtcNow.AddDays(-$RecentDays).ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)
$transactions = [System.Collections.Generic.List[object]]::new()
$pages = 0
$transactionsHttp = $null
$transactionsError = '-'
$continuationKey = $null
do {
    $query = @{ date_from = $dateFrom }
    if ($continuationKey) { $query.continuation_key = $continuationKey }
    $page = Invoke-EbApi -Path "/accounts/$uid/transactions" -Query $query -Headers $psuHeaders
    $transactionsHttp = $page.Status
    if ($page.Status -ne 200) { $transactionsError = Get-ErrorCode $page; break }
    $pages++
    if ($page.Body.transactions) { foreach ($t in $page.Body.transactions) { $transactions.Add($t) } }
    $continuationKey = $page.Body.continuation_key
} while ($continuationKey)
$byStatus = [ordered]@{}
foreach ($group in ($transactions | Group-Object status | Sort-Object Name)) { $byStatus[[string]$group.Name] = $group.Count }

Write-Host "Balance types: $($balanceTypes -join ', ')"
Write-Host "Recent transactions since ${dateFrom}: HTTP $transactionsHttp $(if ($transactionsHttp -ne 200) { $transactionsError }), $($transactions.Count) in $pages page(s), by status: $(($byStatus.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"

# 3. Redacted evidence
$evidencePath = Join-Path $PSScriptRoot "evidence/$(Get-Date -Format 'yyyy-MM-dd')-smoke-test.json"
[ordered]@{
    note                   = 'Redacted: status codes, error codes, balance types and counts only. PSU header values are not recorded.'
    run_utc                = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [cultureinfo]::InvariantCulture)
    psu_headers_sent       = @($psuHeaders.Keys | Sort-Object)
    balance_reads          = $balanceResults
    balance_types          = $balanceTypes
    transactions_date_from = $dateFrom
    transactions_http      = $transactionsHttp
    transactions_error     = $transactionsError
    transactions_count     = $transactions.Count
    transactions_by_status = $byStatus
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Saved redacted summary to $evidencePath"
