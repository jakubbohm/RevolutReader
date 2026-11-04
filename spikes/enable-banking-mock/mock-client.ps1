#Requires -Version 7.5
# Shared helpers for the Mock ASPSP spike. Dot-source it: . "$PSScriptRoot/mock-client.ps1"
# Reuses the M1 client (../enable-banking/eb-client.ps1) but switches it to the SANDBOX application,
# so nothing here can reach the production application or the real Revolut account.

. "$PSScriptRoot/../enable-banking/eb-client.ps1"

$script:EbApplicationId = 'b4780885-a339-48bd-b6b3-067e5056d2ad'   # sandbox application, non-secret (README § Identifiers)
$script:EbKeyPath = Join-Path $PSScriptRoot "../enable-banking/secrets/$script:EbApplicationId.pem"
$script:MockSessionPath = Join-Path $PSScriptRoot 'secrets/session.json'
