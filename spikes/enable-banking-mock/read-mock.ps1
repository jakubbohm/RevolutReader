#Requires -Version 7.5
# Mock ASPSP spike: read balances and all transactions of the accounts in secrets/session.json and
# save the responses unchanged to evidence/ (Mock ASPSP data is made up, so it may be kept).
# Optionally repeats the balance read without PSU headers, to see whether the mock enforces a
# daily limit for unattended requests the way Revolut does (4 a day).
#   pwsh -NoProfile -File spikes/enable-banking-mock/read-mock.ps1 [-BalanceRepeats 6]

param(
    [int] $BalanceRepeats = 0
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/mock-client.ps1"

if (-not (Test-Path -LiteralPath $script:MockSessionPath)) { throw "No session found: $script:MockSessionPath. Run create-mock-session.ps1 first." }
$stored = Get-Content -Raw -LiteralPath $script:MockSessionPath | ConvertFrom-Json -DateKind String
$date = Get-Date -Format 'yyyy-MM-dd'

function Save-Evidence([string] $Name, $Value) {
    $path = Join-Path $PSScriptRoot "evidence/$date-$Name.json"
    $Value | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding utf8
    Write-Host "  saved $path"
}

$status = Invoke-EbApi -Path "/sessions/$($stored.session_id)"
Write-Host "GET /sessions/{id}: HTTP $($status.Status), status=$($status.Body.status)"

$accountNumber = 0
foreach ($uid in @($stored.account_uids)) {
    $accountNumber++
    Write-Host ''
    Write-Host "--- account $accountNumber ---"

    $details = Invoke-EbApi -Path "/accounts/$uid/details"
    Write-Host "GET /accounts/{uid}/details: HTTP $($details.Status)"
    if ($details.Body -is [psobject] -and $details.Body.uid) { $details.Body.uid = '<redacted>' }
    Save-Evidence "account$accountNumber-details" $details.Body

    $balances = Invoke-EbApi -Path "/accounts/$uid/balances"
    Write-Host "GET /accounts/{uid}/balances: HTTP $($balances.Status), balances=$(@($balances.Body.balances).Count)"
    Save-Evidence "account$accountNumber-balances" $balances.Body

    # All pages, following continuation_key, with no date filter (Enable Banking's default period)
    $pages = [System.Collections.Generic.List[object]]::new()
    $key = $null
    do {
        $query = @{}
        if ($key) { $query.continuation_key = $key }
        $page = Invoke-EbApi -Path "/accounts/$uid/transactions" -Query $query
        $pages.Add([ordered]@{ http = $page.Status; body = $page.Body })
        $key = if ($page.Status -eq 200) { $page.Body.continuation_key } else { $null }
        Write-Host "GET /accounts/{uid}/transactions page $($pages.Count): HTTP $($page.Status), transactions=$(@($page.Body.transactions).Count), next page=$([bool]$key)"
    } while ($key -and $pages.Count -lt 50)
    Save-Evidence "account$accountNumber-transactions" $pages

    for ($i = 1; $i -le $BalanceRepeats; $i++) {
        $repeat = Invoke-EbApi -Path "/accounts/$uid/balances"
        $code = if ($repeat.Status -ne 200) { " error=$($repeat.Body.error) $($repeat.Body.message)" } else { '' }
        Write-Host "  balance read $i without PSU headers: HTTP $($repeat.Status)$code"
    }
}
