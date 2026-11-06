#Requires -Version 7.5
# Issue #12 prerequisite: how soon after a Revolut push notification does the change show up in Enable Banking?
# Reads the balance and the recent transactions every few seconds, all with the owner's real PSU headers (the
# owner is at the keyboard). The owner makes a small payment on the account and presses Enter as soon as the
# Revolut notification appears; the script reports when each change was first seen, relative to that moment.
# Prints and records only times, status codes, error codes and counts: no amounts, no identifiers, and no hash
# of the balance (a small amount can be guessed back from its hash). The balance is compared in memory only.
# The owner's public IP is fetched from api.ipify.org, sent only to Enable Banking, never printed or saved.
# The time of day is not recorded either (it would date the payment); the evidence holds the date and offsets.
#   pwsh -NoProfile -File spikes/enable-banking/watch-change.ps1
# Keys while it runs: Enter = the notification has just appeared; Q = stop now (the summary is still saved).
# -SecretsDir: the folder with the key and session.json, when this copy of the script is not next to them.

param(
    [ValidateRange(1, 300)] [int] $IntervalSeconds = 20,
    # How long to keep reading after the notification; also the longest wait for the notification.
    [ValidateRange(0.05, 60)] [double] $MaxMinutes = 15,
    [ValidateRange(1, 30)] [int] $RecentDays = 2,
    [string] $SecretsDir = (Join-Path $PSScriptRoot 'secrets')
)

$ErrorActionPreference = 'Stop'
if ([Console]::IsInputRedirected) { throw 'Run this in your own PowerShell 7 window: it waits for key presses.' }
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
$dateFrom = [DateTimeOffset]::UtcNow.AddDays(-$RecentDays).ToString('yyyy-MM-dd', [cultureinfo]::InvariantCulture)
$script:ApiCalls = 0

function Get-ErrorCode($Result) {
    if ($Result.Body -is [psobject] -and $Result.Body.error) { $Result.Body.error } else { '-' }
}

# One reading: the balance (kept in memory only) and the number of recent transactions by status.
function Read-State {
    $script:ApiCalls++
    $b = Invoke-EbApi -Path "/accounts/$uid/balances" -Headers $psuHeaders
    if ($b.Status -ne 200) { return @{ Ok = $false; Reason = "HTTP $($b.Status) $(Get-ErrorCode $b) on the balance read" } }
    $balanceKey = (@($b.Body.balances) | Where-Object { $_ } |
        ForEach-Object { "$($_.balance_type) $($_.balance_amount.amount) $($_.balance_amount.currency)" } |
        Sort-Object) -join '|'

    $counts = [ordered]@{}
    $continuationKey = $null
    do {
        $query = @{ date_from = $dateFrom }
        if ($continuationKey) { $query.continuation_key = $continuationKey }
        $script:ApiCalls++
        $page = Invoke-EbApi -Path "/accounts/$uid/transactions" -Query $query -Headers $psuHeaders
        if ($page.Status -ne 200) { return @{ Ok = $false; Reason = "HTTP $($page.Status) $(Get-ErrorCode $page) on the transactions read" } }
        foreach ($t in @($page.Body.transactions)) {
            if ($t) { $s = [string]$t.status; $counts[$s] = 1 + [int]$counts[$s] }
        }
        $continuationKey = $page.Body.continuation_key
    } while ($continuationKey)
    @{ Ok = $true; BalanceKey = $balanceKey; Counts = $counts }
}

# What changed between two readings, e.g. 'balance', 'PDNG 0->1', 'BOOK 23->24'.
function Compare-State($Old, $New) {
    $changes = @()
    if ($New.BalanceKey -ne $Old.BalanceKey) { $changes += 'balance' }
    foreach ($s in (@($Old.Counts.Keys) + @($New.Counts.Keys) | Sort-Object -Unique)) {
        $was = [int]$Old.Counts[$s]; $now = [int]$New.Counts[$s]
        if ($was -ne $now) { $changes += "$s $was->$now" }
    }
    $changes
}

function Format-Counts($Counts) {
    if ($Counts.Count -eq 0) { return 'none' }
    ($Counts.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '
}

$clock = [Diagnostics.Stopwatch]::StartNew()
$notifiedAt = $null          # seconds since the start, when Enter was pressed
$readings = [System.Collections.Generic.List[object]]::new()
$changeLog = [System.Collections.Generic.List[object]]::new()
$stopReason = $null

# Seconds relative to the notification once it is marked, otherwise to the start.
function Get-Offset([double] $SinceStart) {
    if ($null -ne $notifiedAt) { [Math]::Round($SinceStart - $notifiedAt, 1) } else { [Math]::Round($SinceStart, 1) }
}
function Format-Time([double] $SinceStart) {
    $s = [int][Math]::Round($SinceStart)
    if ($null -ne $notifiedAt) { '{0,5} s after the notification' -f ('{0:+0;-0;0}' -f [int][Math]::Round($SinceStart - $notifiedAt)) }
    else { '{0,5} s after the start' -f ('+' + $s) }
}

$baseline = Read-State
if (-not $baseline.Ok) { throw "First reading failed: $($baseline.Reason)." }
$previous = $baseline
$previousAt = $clock.Elapsed.TotalSeconds
Write-Host "First reading done. Transactions since $dateFrom by status: $(Format-Counts $baseline.Counts)."
Write-Host ''
Write-Host 'Now make a small payment or transfer on the account.'
Write-Host 'Press Enter as soon as the Revolut notification appears on the phone. Press Q to stop.'
Write-Host "Reading every $IntervalSeconds s, until $MaxMinutes min after the notification."
Write-Host ''
while ([Console]::KeyAvailable) { [void][Console]::ReadKey($true) }   # ignore keys pressed before this point

$nextReading = $previousAt + $IntervalSeconds
$balanceSeen = $false
$bookedSeen = $false
while (-not $stopReason) {
    # Wait for the next reading, watching the keyboard.
    while (-not $stopReason -and $clock.Elapsed.TotalSeconds -lt $nextReading) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Enter -and $null -eq $notifiedAt) {
                $notifiedAt = $clock.Elapsed.TotalSeconds
                Write-Host "Notification marked at $([int][Math]::Round($notifiedAt)) s after the start."
            }
            elseif ($key.Key -eq [ConsoleKey]::Q) { $stopReason = 'stopped by the owner (Q)' }
        }
        Start-Sleep -Milliseconds 200
    }
    if ($stopReason) { break }
    $deadline = if ($null -ne $notifiedAt) { $notifiedAt + 60 * $MaxMinutes } else { 60 * $MaxMinutes }
    if ($clock.Elapsed.TotalSeconds -ge $deadline) {
        $stopReason = if ($null -ne $notifiedAt) { "$MaxMinutes min after the notification" } else { "no notification marked within $MaxMinutes min" }
        break
    }

    $at = $clock.Elapsed.TotalSeconds
    try { $state = Read-State }
    catch {
        # Only the exception type: a message could quote the request address, which holds the account UID.
        $state = @{ Ok = $false; Reason = "request failed ($($_.Exception.GetType().Name))" }
    }
    if (-not $state.Ok) {
        $stopReason = $state.Reason
        Write-Host "$(Format-Time $at): $stopReason - stopping."
        break
    }
    $changes = @(Compare-State $previous $state)
    $readings.Add(@{ at = $at; changes = $changes })
    foreach ($c in $changes) {
        $changeLog.Add(@{ change = $c; seen = $at; previous = $previousAt })
        if ($null -ne $notifiedAt) {
            if ($c -eq 'balance') { $balanceSeen = $true }
            if ($c -match '^BOOK (\d+)->(\d+)$' -and [int]$Matches[2] -gt [int]$Matches[1]) { $bookedSeen = $true }
        }
    }
    $line = if ($changes) { ($changes | ForEach-Object { if ($_ -eq 'balance') { 'balance changed' } else { $_ } }) -join '; ' } else { 'no change' }
    Write-Host "$(Format-Time $at): $line"
    $previous = $state
    $previousAt = $at
    if ($balanceSeen -and $bookedSeen) { $stopReason = 'the balance changed and a booked transaction appeared'; break }
    $nextReading = [Math]::Max($nextReading + $IntervalSeconds, $clock.Elapsed.TotalSeconds + 1)
}

# Summary: each change, with the window it happened in (between the reading before and the one that saw it).
$reference = if ($null -ne $notifiedAt) { 'the notification' } else { 'the start (no notification marked)' }
Write-Host ''
Write-Host "Stopped: $stopReason. Successful readings: $(1 + $readings.Count) ($($script:ApiCalls) API calls). Times relative to $reference."
if ($changeLog.Count -eq 0) { Write-Host 'No change seen.' }
foreach ($e in $changeLog) {
    # String interpolation formats the offsets with a decimal point whatever the console's language.
    Write-Host "  $($e.change.PadRight(12)) between $(Get-Offset $e.previous) s and $(Get-Offset $e.seen) s"
}
Write-Host "Transactions since $dateFrom by status at the end: $(Format-Counts $previous.Counts)."

$evidenceDir = Join-Path $PSScriptRoot 'evidence'
$evidencePath = Join-Path $evidenceDir "$(Get-Date -Format 'yyyy-MM-dd')-watch-change.json"
for ($n = 2; Test-Path -LiteralPath $evidencePath; $n++) {
    $evidencePath = Join-Path $evidenceDir "$(Get-Date -Format 'yyyy-MM-dd')-watch-change-$n.json"
}
[ordered]@{
    note                = 'Redacted: offsets in seconds, status codes, error codes and transaction counts only. Balances were compared in memory and are not recorded, nor are the PSU header values or the time of day.'
    run_date            = Get-Date -Format 'yyyy-MM-dd'
    times_relative_to   = $reference
    psu_headers_sent    = @($psuHeaders.Keys | Sort-Object)
    interval_seconds    = $IntervalSeconds
    max_minutes         = $MaxMinutes
    recent_days         = $RecentDays
    notification_marked = ($null -ne $notifiedAt)
    notification_after_start_s = if ($null -ne $notifiedAt) { [Math]::Round($notifiedAt, 1) } else { $null }
    readings            = 1 + $readings.Count
    api_calls           = $script:ApiCalls
    stopped             = $stopReason
    counts_at_start     = $baseline.Counts
    counts_at_end       = $previous.Counts
    changes             = @($changeLog | ForEach-Object { [ordered]@{ change = $_.change; between_s = (Get-Offset $_.previous); and_s = (Get-Offset $_.seen) } })
    reading_offsets_s   = @($readings | ForEach-Object { [ordered]@{ at_s = (Get-Offset $_.at); changes = $_.changes } })
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Saved redacted summary to $evidencePath"
