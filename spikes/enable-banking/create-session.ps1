#Requires -Version 7.5
# Spike step 5: authorise an API session for Revolut (LT, personal), keep its IDs in secrets/, and
# download the transaction history right away (export-history.ps1).
# Touches the bank: the account holder approves the access in the Revolut app.
# Run in your own PowerShell 7 window, from the repository root:
#   pwsh -NoProfile -File spikes/enable-banking/create-session.ps1 -HistoryStart 2026-08-09
# Prints no identifiers, balances or transactions. The session ID and account UIDs go only to
# secrets/session.json (gitignored); redacted summaries go to evidence/.

param(
    # First day of the transaction history to download right after the approval (local date, yyyy-MM-dd).
    [string] $HistoryStart = '2026-08-09'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/eb-client.ps1"

# Check the date before the approval, so a typo cannot waste the 5-minute window.
$null = [datetime]::ParseExact($HistoryStart, 'yyyy-MM-dd', [cultureinfo]::InvariantCulture)

$sessionPath = Join-Path $PSScriptRoot 'secrets/session.json'
if (Test-Path -LiteralPath $sessionPath) {
    throw "A session is already stored in $sessionPath. Move that file away first if you really want a new session."
}

function Write-EbError($Step, $Result) {
    # Enable Banking error code and message, no secrets.
    Write-Host "$Step failed: HTTP $($Result.Status) $($Result.Raw)"
}

$invariant = [cultureinfo]::InvariantCulture
$maxValiditySeconds = 15552000   # Revolut's maximum_consent_validity, GET /aspsps 2026-11-04 (README § Findings)
$validUntilRequested = [DateTimeOffset]::UtcNow.AddSeconds($maxValiditySeconds - 3600).ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", $invariant)
$state = [guid]::NewGuid().ToString()

# 1. Start the authorisation
$auth = Invoke-EbApi -Method POST -Path '/auth' -Body ([ordered]@{
    access       = [ordered]@{ valid_until = $validUntilRequested; balances = $true; transactions = $true }
    aspsp        = [ordered]@{ name = 'Revolut'; country = 'LT' }
    state        = $state
    redirect_url = 'https://localhost/callback'
    psu_type     = 'personal'
})
if ($auth.Status -ne 200) { Write-EbError 'POST /auth' $auth; exit 1 }

Write-Host "Requested session end: $validUntilRequested"
Write-Host ''
Write-Host 'Opening the approval page in your browser:'
Write-Host '  1. Continue on the Enable Banking page and approve the access in the Revolut app.'
Write-Host '  2. The browser then shows an error page on https://localhost/callback. That is expected.'
Write-Host '  3. Copy the full address from the browser address bar and paste it here straight away'
Write-Host "     (history older than 90 days, here since $HistoryStart, is available only for 5 minutes after the approval)."
Write-Host "If the browser does not open, open this address yourself:`n$($auth.Body.url)"
Start-Process $auth.Body.url
Write-Host ''

# 2. Take the code from the redirect address
$redirected = (Read-Host 'Address from the browser').Trim()
$query = [System.Web.HttpUtility]::ParseQueryString(([Uri]$redirected).Query)
if ($query['error']) {
    Write-Host "The bank or Enable Banking returned an error: $($query['error']) - $($query['error_description'])"
    exit 1
}
if ($query['state'] -ne $state) { throw 'The state in the address does not match this run. Did you paste the address from this approval?' }
if (-not $query['code']) { throw 'No code found in the address.' }

# 3. Create the session and store its IDs
$session = Invoke-EbApi -Method POST -Path '/sessions' -Body @{ code = $query['code'] }
if ($session.Status -ne 200) { Write-EbError 'POST /sessions' $session; exit 1 }
$accounts = @($session.Body.accounts)
$createdUtc = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', $invariant)

[ordered]@{
    session_id   = $session.Body.session_id
    account_uids = @($accounts | ForEach-Object { $_.uid } | Where-Object { $_ })
    created_utc  = $createdUtc
    valid_until  = $session.Body.access.valid_until
} | ConvertTo-Json | Set-Content -LiteralPath $sessionPath -Encoding utf8

Write-Host ''
Write-Host "POST /sessions: HTTP $($session.Status)"
Write-Host "Session end granted:   $($session.Body.access.valid_until)"
Write-Host "Accounts in session:   $($accounts.Count)"
foreach ($account in $accounts) {
    Write-Host "  - currency=$($account.currency) type=$($account.cash_account_type) psu_status=$($account.psu_status) uid present=$([bool]$account.uid)"
}
Write-Host "Saved session ID and account UIDs to $sessionPath (never commit or share)."

# 4. Download the history immediately, while the 5-minute window is open
$historyOk = $true
try {
    & "$PSScriptRoot/export-history.ps1" -HistoryStart $HistoryStart
}
catch {
    $historyOk = $false
    Write-Host ''
    Write-Host "History download failed: $($_.Exception.Message)"
    Write-Host "The session is saved. Run export-history.ps1 -HistoryStart $HistoryStart on its own; it reaches that date only while it is within the last 90 days."
}

# 5. Check the session status and that the application is still active
$status = Invoke-EbApi -Path "/sessions/$($session.Body.session_id)"
$application = Invoke-EbApi -Path '/application'
Write-Host ''
Write-Host "GET /sessions/{id}:    HTTP $($status.Status), status=$($status.Body.status)"
Write-Host "GET /application:      HTTP $($application.Status), active=$($application.Body.active), environment=$($application.Body.environment)"

# 6. Redacted evidence: statuses, dates, counts and field names only
$evidencePath = Join-Path $PSScriptRoot "evidence/$(Get-Date -Format 'yyyy-MM-dd')-session.json"
[ordered]@{
    note                  = 'Redacted: no session ID, account identifiers, names, balances or transactions.'
    created_utc           = $createdUtc
    valid_until_requested = $validUntilRequested
    valid_until_granted   = $session.Body.access.valid_until
    post_auth_http        = $auth.Status
    post_sessions_http    = $session.Status
    session_status        = $status.Body.status
    application_active    = $application.Body.active
    accounts_count        = $accounts.Count
    accounts_with_uid     = @($accounts | Where-Object { $_.uid }).Count
    history_downloaded    = $historyOk
    session_fields        = @($session.Body.PSObject.Properties.Name | Sort-Object)
    account_fields        = @($accounts | ForEach-Object { $_.PSObject.Properties.Name } | Sort-Object -Unique)
} | ConvertTo-Json | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Saved redacted summary to $evidencePath"
