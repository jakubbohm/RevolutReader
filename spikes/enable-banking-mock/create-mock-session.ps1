#Requires -Version 7.5
# Mock ASPSP spike: authorise an API session for the sandbox application against Enable Banking's
# Mock ASPSP (made-up data only), keep its IDs in secrets/, then read the data (read-mock.ps1).
# Needs you at the keyboard: the mock bank's approval page requires your Control Panel login.
# Run in your own PowerShell 7 window, from the repository root:
#   pwsh -NoProfile -File spikes/enable-banking-mock/create-mock-session.ps1
# If an approval was already started (secrets/auth-state.json exists), it only asks for the address;
# pass -New to start a fresh approval instead.

param(
    [switch] $New,
    # The redirected https://localhost/callback?... address, if already at hand (skips the prompt).
    [string] $CallbackUrl
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/mock-client.ps1"

$statePath = Join-Path $PSScriptRoot 'secrets/auth-state.json'
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'secrets') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PSScriptRoot 'evidence') | Out-Null

function Write-EbError($Step, $Result) {
    Write-Host "$Step failed: HTTP $($Result.Status) $($Result.Raw)"
}

$invariant = [cultureinfo]::InvariantCulture

# 1. Start the authorisation, unless one is already waiting for its address
if ($New -or -not (Test-Path -LiteralPath $statePath)) {
    $validUntil = [DateTimeOffset]::UtcNow.AddDays(10).ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz", $invariant)
    $state = [guid]::NewGuid().ToString()
    $auth = Invoke-EbApi -Method POST -Path '/auth' -Body ([ordered]@{
        access       = [ordered]@{ valid_until = $validUntil; balances = $true; transactions = $true }
        aspsp        = [ordered]@{ name = 'Mock ASPSP'; country = 'LT' }
        state        = $state
        redirect_url = 'https://localhost/callback'
        psu_type     = 'personal'
    })
    if ($auth.Status -ne 200) { Write-EbError 'POST /auth' $auth; exit 1 }
    @{ state = $state } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

    Write-Host 'Opening the approval page in your browser:'
    Write-Host '  1. Click "Continue authentication".'
    Write-Host '  2. Tick the account(s) to share (e.g. "RevolutReader Test") and click "Authorize".'
    Write-Host '  3. The browser then shows an error page on https://localhost/callback. That is expected.'
    Write-Host "If the browser does not open, open this address yourself:`n$($auth.Body.url)"
    Start-Process $auth.Body.url
}
else {
    Write-Host 'An approval is already waiting. Use the browser tab that shows the https://localhost/callback error page.'
}
$state = (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json).state
Write-Host 'Copy the full address from the browser address bar and paste it here.'
Write-Host ''

# 2. Take the code from the redirect address
$redirected = if ($CallbackUrl) { $CallbackUrl.Trim() } else { (Read-Host 'Address from the browser').Trim() }
$query = [System.Web.HttpUtility]::ParseQueryString(([Uri]$redirected).Query)
if ($query['error']) {
    Write-Host "Enable Banking returned an error: $($query['error']) - $($query['error_description'])"
    exit 1
}
if ($query['state'] -ne $state) { throw 'The state in the address does not match the waiting approval. Run again with -New.' }
if (-not $query['code']) { throw 'No code found in the address.' }

# 3. Create the session and store its IDs
$session = Invoke-EbApi -Method POST -Path '/sessions' -Body @{ code = $query['code'] }
if ($session.Status -ne 200) {
    Write-EbError 'POST /sessions' $session
    Write-Host 'If the code expired, run again with -New.'
    exit 1
}
Remove-Item -LiteralPath $statePath
$accounts = @($session.Body.accounts)
$createdUtc = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', $invariant)
[ordered]@{
    session_id   = $session.Body.session_id
    account_uids = @($accounts | ForEach-Object { $_.uid } | Where-Object { $_ })
    created_utc  = $createdUtc
    valid_until  = $session.Body.access.valid_until
} | ConvertTo-Json | Set-Content -LiteralPath $script:MockSessionPath -Encoding utf8

Write-Host ''
Write-Host "POST /sessions: HTTP $($session.Status), accounts: $($accounts.Count), valid until: $($session.Body.access.valid_until)"
Write-Host "Saved session ID and account UIDs to $script:MockSessionPath (never commit)."

# 4. Evidence: the response as sent, minus the session ID and account UIDs (made-up data otherwise)
$evidence = $session.Raw | ConvertFrom-Json -DateKind String
$evidence.session_id = '<redacted>'
foreach ($account in @($evidence.accounts)) { if ($account.uid) { $account.uid = '<redacted>' } }
$evidencePath = Join-Path $PSScriptRoot "evidence/$(Get-Date -Format 'yyyy-MM-dd')-post-sessions.json"
$evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host "Saved $evidencePath"

# 5. Read the data right away
& "$PSScriptRoot/read-mock.ps1"
