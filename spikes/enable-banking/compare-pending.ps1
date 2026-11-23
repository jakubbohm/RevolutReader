#Requires -Version 7.5
# Spike step 9 (issue #85): what became of each pending transaction of an earlier read-pending.ps1 read in a later
# one, matched by entry_reference. Reads the two raw files from secrets/ (bank data, gitignored). Prints counts only
# (no amounts, names, references or dates); with -EvidenceOut it writes the same counts as evidence.
#   pwsh -NoProfile -File spikes/enable-banking/compare-pending.ps1 `
#       -Earlier spikes/enable-banking/secrets/pending-2026-11-21.json `
#       -Later spikes/enable-banking/secrets/pending-2026-11-22.json `
#       -EvidenceOut spikes/enable-banking/evidence/2026-11-22-pending-settlement.json

param(
    [Parameter(Mandatory)] [string] $Earlier,
    [Parameter(Mandatory)] [string] $Later,
    [string] $EvidenceOut
)
$ErrorActionPreference = 'Stop'

function Read-Saved([string] $Path) {
    $saved = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -DateKind String
    $transactions = foreach ($raw in $saved.pages_raw) { ($raw | ConvertFrom-Json -DateKind String).transactions }
    @{ ReadAt = $saved.read_at; Transactions = @($transactions) }
}
function Same($a, $b) { ($a | ConvertTo-Json -Depth 10 -Compress) -eq ($b | ConvertTo-Json -Depth 10 -Compress) }

$before = Read-Saved $Earlier
$after = Read-Saved $Later
$beforeRefs = @{}; foreach ($t in $before.Transactions) { if ($t.entry_reference) { $beforeRefs[$t.entry_reference] = $t } }
$afterRefs = @{}; foreach ($t in $after.Transactions) { if ($t.entry_reference) { $afterRefs[$t.entry_reference] = $t } }
$newBooked = @($after.Transactions | Where-Object { $_.status -eq 'BOOK' -and $_.entry_reference -and -not $beforeRefs.ContainsKey($_.entry_reference) })

$pending = @($before.Transactions | Where-Object status -ne 'BOOK')
$counts = [ordered]@{
    pending_before                   = $pending.Count
    pending_without_reference        = 0
    still_pending_same_reference     = 0
    booked_same_reference            = 0
    gone_by_reference                = 0
    gone_with_a_new_booked_lookalike = 0
}
$fieldsSame = [ordered]@{ booking_date = 0; transaction_amount = 0; creditor = 0; debtor = 0; remittance_information = 0; bank_transaction_code = 0 }
$valueDateLag = @{}
$i = 0
foreach ($p in $pending) {
    $i++
    if (-not $p.entry_reference) { $counts.pending_without_reference++; Write-Host "  #${i}: no reference, not looked up"; continue }
    $now = $afterRefs[$p.entry_reference]
    if ($null -eq $now) {
        $counts.gone_by_reference++
        $lookalike = @($newBooked | Where-Object { (Same $_.creditor $p.creditor) -and (Same $_.transaction_amount.currency $p.transaction_amount.currency) })
        if ($lookalike.Count -gt 0) { $counts.gone_with_a_new_booked_lookalike++ }
        Write-Host "  #${i}: not found by its reference; new booked with the same creditor: $($lookalike.Count)"
        continue
    }
    if ($now.status -ne 'BOOK') { $counts.still_pending_same_reference++; Write-Host "  #${i}: still pending, same reference"; continue }
    $counts.booked_same_reference++
    $diff = @()
    foreach ($f in @($fieldsSame.Keys)) { if (Same $now.$f $p.$f) { $fieldsSame[$f]++ } else { $diff += $f } }
    $lag = if ($now.value_date) { [DateOnly]::ParseExact($now.value_date, 'yyyy-MM-dd').DayNumber - [DateOnly]::ParseExact($now.booking_date, 'yyyy-MM-dd').DayNumber } else { 'none' }
    $valueDateLag["$lag"] = 1 + [int]$valueDateLag["$lag"]
    Write-Host "  #${i}: booked under the same reference; changed: $(if ($diff) { $diff -join ', ' } else { 'nothing compared' }); value_date - booking_date: $lag"
}

$pendingNow = @($after.Transactions | Where-Object status -ne 'BOOK').Count
if ($counts.still_pending_same_reference -gt $pendingNow) { throw "Inconsistent: $($counts.still_pending_same_reference) still pending, but the later read holds only $pendingNow pending." }
Write-Host "Earlier read $($before.ReadAt), later read $($after.ReadAt); later read: $pendingNow pending, $($newBooked.Count) booked that were not booked before"
$counts.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-34}: {1}" -f $_.Key, $_.Value) }
Write-Host '  of those booked under the same reference, unchanged:'
$fieldsSame.GetEnumerator() | ForEach-Object { Write-Host ("    {0,-24}: {1} of {2}" -f $_.Key, $_.Value, $counts.booked_same_reference) }

if ($EvidenceOut) {
    [ordered]@{
        note                               = 'Redacted: counts only. Issue #85: does a pending transaction keep its entry_reference when it settles?'
        earlier_read_utc                   = $before.ReadAt
        later_read_utc                     = $after.ReadAt
        outcome                            = $counts
        unchanged_on_settling              = $fieldsSame
        value_date_minus_booking_date_days = $valueDateLag
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidenceOut -Encoding utf8
    Write-Host "Saved counts to $EvidenceOut"
}
