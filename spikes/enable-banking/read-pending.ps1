#Requires -Version 7.5
# Spike step 9 (issue #85): does a pending transaction keep its entry_reference when it settles?
# One present-user read of the last -RecentDays days of transactions, saved raw (exactly as Enable Banking sent
# each page) into the gitignored secrets/ folder, for compare-pending.ps1 after settlement. The saved file holds
# bank data: it is never printed or committed. Prints counts and field presence only: no amounts, names,
# references or dates. The owner's public IP is fetched from api.ipify.org, sent only to Enable Banking, never
# printed or saved.
#   pwsh -NoProfile -File spikes/enable-banking/read-pending.ps1
# -OutFile: where the raw read goes (default secrets/pending-<UTC date>.json); -SecretsDir <folder> when the key
# and session.json are not in this copy's secrets/, e.g. when running it from a worktree.

param(
    [ValidateRange(1, 89)] [int] $RecentDays = 31,
    [string] $SecretsDir = (Join-Path $PSScriptRoot 'secrets'),
    [string] $OutFile
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/eb-client.ps1"
$script:EbKeyPath = Join-Path $SecretsDir "$script:EbApplicationId.pem"

$sessionPath = Join-Path $SecretsDir 'session.json'
$stored = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -DateKind String
$uid = @($stored.account_uids | Where-Object { $_ })[0]
if (-not $uid) { throw "No account UID in $sessionPath." }

$ip = ([string](Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15)).Trim()
if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Unexpected answer from api.ipify.org (expected an IPv4 address).' }
$psuHeaders = @{
    'Psu-Ip-Address' = $ip
    'Psu-User-Agent' = "RevolutReader-spike/1.0 PowerShell/$($PSVersionTable.PSVersion)"
}

$readAt = [DateTimeOffset]::UtcNow
if (-not $OutFile) { $OutFile = Join-Path $SecretsDir "pending-$($readAt.ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)).json" }
$dateFrom = $readAt.AddDays(-$RecentDays).ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)
$pages = [System.Collections.Generic.List[object]]::new()
$transactions = [System.Collections.Generic.List[object]]::new()
$continuationKey = $null
do {
    $query = @{ date_from = $dateFrom }
    if ($continuationKey) { $query.continuation_key = $continuationKey }
    $page = Invoke-EbApi -Path "/accounts/$uid/transactions" -Query $query -Headers $psuHeaders
    if ($page.Status -ne 200) {
        $code = if ($page.Body -is [psobject] -and $page.Body.error) { $page.Body.error } else { '-' }
        throw "Transactions page $($pages.Count + 1): HTTP $($page.Status) $code"
    }
    $pages.Add($page.Raw)
    if ($page.Body.transactions) { foreach ($t in $page.Body.transactions) { $transactions.Add($t) } }
    $continuationKey = $page.Body.continuation_key
} while ($continuationKey)

# Raw pages kept as sent (each a JSON text), with when and how they were read; never the IP.
[ordered]@{
    note       = 'Bank data, local only (gitignored). Raw Enable Banking transaction pages, exactly as sent. Issue #85: does a pending transaction keep its entry_reference when it settles?'
    read_at    = $readAt.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [cultureinfo]::InvariantCulture)
    date_from  = $dateFrom
    psu        = 'present user: owner''s public IP and the spike user agent (values not recorded)'
    pages_raw  = $pages
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutFile -Encoding utf8

$byStatus = $transactions | Group-Object status | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }
Write-Host "Read $($transactions.Count) transactions of the last $RecentDays days in $($pages.Count) page(s); $($byStatus -join ', ')"

$pending = @($transactions | Where-Object { $_.status -ne 'BOOK' })
$fields = 'entry_reference', 'transaction_id', 'booking_date', 'value_date', 'transaction_date', 'bank_transaction_code', 'creditor', 'debtor', 'remittance_information', 'exchange_rate', 'merchant_category_code', 'reference_number', 'note'
foreach ($f in $fields) {
    $has = @($pending | Where-Object { $null -ne $_.$f -and "$($_.$f)" -ne '' }).Count
    Write-Host ("  pending with {0,-24}: {1} of {2}" -f $f, $has, $pending.Count)
}
$allNames = $pending | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique
Write-Host "  field names on pending: $($allNames -join ', ')"
$refs = @($transactions | Where-Object { $_.entry_reference } | ForEach-Object { $_.entry_reference })
Write-Host "  distinct entry_reference across all: $(@($refs | Sort-Object -Unique).Count) of $($refs.Count)"
$tids = @($transactions | Where-Object { $_.transaction_id } | ForEach-Object { $_.transaction_id })
Write-Host "  with transaction_id across all: $($tids.Count); equal to entry_reference: $(@($transactions | Where-Object { $_.transaction_id -and $_.transaction_id -eq $_.entry_reference }).Count)"
Write-Host "Saved the raw pages to $OutFile (bank data: never commit it)"
