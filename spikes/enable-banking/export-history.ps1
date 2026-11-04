#Requires -Version 7.5
# History download (ADR-0001-bank-data-access § Decision, item 6): all transactions since -HistoryStart
# for the accounts in secrets/session.json, saved unchanged to secrets/ (gitignored).
# The file holds bank data: it is never printed or committed; it is imported once the database exists
# and then deleted. Prints and records only counts and field names.
#
# create-session.ps1 calls this right after the approval: Revolut returns transactions older than
# 90 days only within 5 minutes after it. Run on its own (no PSU headers, so it uses one of Revolut's
# 4 unattended requests a day; paging through one response does not count), it reaches -HistoryStart
# only while that date is within the last 90 days:
#   pwsh -NoProfile -File spikes/enable-banking/export-history.ps1 -HistoryStart 2026-08-09

param(
    # First day of the history, as a local date (yyyy-MM-dd). RevolutReader keeps history from 2026-08-09.
    [string] $HistoryStart = '2026-08-09'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/eb-client.ps1"

# Enable Banking reads dates as UTC, so the download starts one day earlier to cover the local start date.
$historyStartDate = [datetime]::ParseExact($HistoryStart, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture)
$DateFrom = $historyStartDate.AddDays(-1).ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)

$sessionPath = Join-Path $PSScriptRoot 'secrets/session.json'
if (-not (Test-Path -LiteralPath $sessionPath)) { throw "No session found: $sessionPath. Run create-session.ps1 first." }
$stored = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -DateKind String
$uids = @($stored.account_uids | Where-Object { $_ })
if ($uids.Count -eq 0) { throw 'The session has no readable accounts. A restricted application returns only accounts linked in the Control Panel.' }

$exportedUtc = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', [cultureinfo]::InvariantCulture)
$exportPath = Join-Path $PSScriptRoot "secrets/transactions-$(Get-Date -Format 'yyyy-MM-dd').json"
$accountJson = [System.Collections.Generic.List[string]]::new()
$summaries = [System.Collections.Generic.List[object]]::new()
$dateRanges = @()
$accountNumber = 0

foreach ($uid in $uids) {
    $accountNumber++
    $rawPages = [System.Collections.Generic.List[string]]::new()
    $transactions = [System.Collections.Generic.List[object]]::new()
    $continuationKey = $null
    do {
        # All parameters except continuation_key must stay the same across pages.
        $query = @{ date_from = $DateFrom }
        if ($continuationKey) { $query.continuation_key = $continuationKey }
        $page = Invoke-EbApi -Path "/accounts/$uid/transactions" -Query $query
        if ($page.Status -ne 200) {
            # Enable Banking error code and message, no bank data.
            throw "GET /accounts/{uid}/transactions failed for account $accountNumber, page $($rawPages.Count + 1): HTTP $($page.Status) $($page.Raw)"
        }
        $rawPages.Add($page.Raw)
        if ($page.Body.transactions) { foreach ($t in $page.Body.transactions) { $transactions.Add($t) } }
        $continuationKey = $page.Body.continuation_key
    } while ($continuationKey)

    # Raw pages go into the file unchanged, so the later import sees exactly what the bank sent.
    $accountJson.Add("{`"account`":$accountNumber,`"pages`":[$($rawPages -join ',')]}")

    $booked = @($transactions | Where-Object { $_.status -eq 'BOOK' })
    $bookedRefs = @($booked | Where-Object { $_.entry_reference } | ForEach-Object { $_.entry_reference })
    $bookedDates = @($booked | Where-Object { $_.booking_date } | ForEach-Object { $_.booking_date } | Sort-Object)
    $byStatus = [ordered]@{}
    foreach ($group in ($transactions | Group-Object status | Sort-Object Name)) { $byStatus[[string]$group.Name] = $group.Count }
    # Evidence: counts and field names only.
    $summaries.Add([ordered]@{
        account                        = $accountNumber
        pages                          = $rawPages.Count
        transactions                   = $transactions.Count
        by_status                      = $byStatus
        booked_without_entry_reference = $booked.Count - $bookedRefs.Count
        booked_duplicate_entry_refs    = $bookedRefs.Count - @($bookedRefs | Sort-Object -Unique).Count
        pending_with_entry_reference   = @($transactions | Where-Object { $_.status -eq 'PDNG' -and $_.entry_reference }).Count
        transaction_fields             = @($transactions | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique)
    })
    # Printed only, never written to evidence.
    $dateRanges += , @(($bookedDates | Select-Object -First 1), ($bookedDates | Select-Object -Last 1))
}

$content = "{`"exported_utc`":`"$exportedUtc`",`"history_start`":`"$HistoryStart`",`"date_from`":`"$DateFrom`",`"accounts`":[$($accountJson -join ',')]}"
Set-Content -LiteralPath $exportPath -Value $content -Encoding utf8 -NoNewline

Write-Host ''
Write-Host "History download since $HistoryStart (requested from $DateFrom UTC):"
foreach ($s in $summaries) {
    Write-Host "  Account $($s.account): $($s.transactions) transactions in $($s.pages) page(s)"
    Write-Host "    by status:                      $(($s.by_status.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', ')"
    Write-Host "    settled without entry_reference: $($s.booked_without_entry_reference)"
    Write-Host "    duplicate settled references:    $($s.booked_duplicate_entry_refs)"
    Write-Host "    pending with entry_reference:    $($s.pending_with_entry_reference)"
    Write-Host "    settled booking dates:           $($dateRanges[$s.account - 1][0]) to $($dateRanges[$s.account - 1][1])"
}
Write-Host "Saved to $exportPath (bank data: keep it local, never commit or share)."

$evidencePath = Join-Path $PSScriptRoot "evidence/$(Get-Date -Format 'yyyy-MM-dd')-history-export.json"
[ordered]@{
    note         = 'Redacted: counts and field names only. The transactions themselves stay in secrets/.'
    exported_utc  = $exportedUtc
    history_start = $HistoryStart
    date_from     = $DateFrom
    accounts     = $summaries
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Saved redacted summary to $evidencePath"
