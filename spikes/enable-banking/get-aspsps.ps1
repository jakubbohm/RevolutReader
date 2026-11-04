#Requires -Version 7.0
# Spike step 3: read Revolut's public metadata from Enable Banking's bank list (GET /aspsps).
# Does not contact Revolut. Prints a summary and saves the Revolut entries to evidence/.
# Run: pwsh -NoProfile -File spikes/enable-banking/get-aspsps.ps1

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/eb-client.ps1"

$result = Invoke-EbApi -Path '/aspsps'
if ($result.Status -ne 200) {
    # Enable Banking error bodies hold an error code and message, no secrets.
    Write-Host "GET /aspsps failed: HTTP $($result.Status)"
    $result.Body | ConvertTo-Json -Depth 5 | Write-Host
    exit 1
}

$all = @($result.Body.aspsps)
$revolut = @($all | Where-Object { $_.name -match 'Revolut' } | Sort-Object country, name)

Write-Host "GET /aspsps: HTTP 200, $($all.Count) banks listed, $($revolut.Count) Revolut entries"
Write-Host "Revolut countries: $(($revolut.country | Sort-Object -Unique) -join ', ')"
Write-Host "Czechia (CZ) listed for Revolut: $(if ($revolut.country -contains 'CZ') { 'yes' } else { 'no' })"
Write-Host "Distinct maximum_consent_validity values across Revolut entries (days): $(($revolut | ForEach-Object { [math]::Round($_.maximum_consent_validity / 86400, 1) } | Sort-Object -Unique) -join ', ')"

foreach ($entry in $revolut | Where-Object country -eq 'LT') {
    Write-Host ''
    Write-Host "--- $($entry.name) / $($entry.country) ---"
    Write-Host "maximum_consent_validity: $($entry.maximum_consent_validity) s = $([math]::Round($entry.maximum_consent_validity / 86400, 1)) days"
    Write-Host "required_psu_headers:     $(if ($entry.required_psu_headers) { $entry.required_psu_headers -join ', ' } else { '(none listed)' })"
    Write-Host "psu_types:                $($entry.psu_types -join ', ')"
    Write-Host "beta:                     $($entry.beta)"
    Write-Host "bic:                      $($entry.bic)"
    Write-Host 'auth_methods:'
    foreach ($method in $entry.auth_methods) {
        Write-Host "  - name=$($method.name) psu_type=$($method.psu_type) approach=$($method.approach) hidden=$($method.hidden_method) credentials=$(if ($method.credentials) { @($method.credentials).Count } else { 0 })"
    }
    Write-Host "fields present:           $(($entry.PSObject.Properties.Name | Sort-Object) -join ', ')"
}

# Public bank metadata only: nothing about the owner's account.
$evidenceDir = Join-Path $PSScriptRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$evidencePath = Join-Path $evidenceDir "$(Get-Date -Format 'yyyy-MM-dd')-aspsps-revolut.json"
[ordered]@{
    source    = 'GET https://api.enablebanking.com/aspsps (no filters)'
    retrieved = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    note      = 'Public ASPSP metadata, entries whose name matches "Revolut". No account data.'
    entries   = $revolut
} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding utf8
Write-Host ''
Write-Host "Saved: $evidencePath"
