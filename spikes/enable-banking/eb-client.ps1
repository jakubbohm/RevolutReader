#Requires -Version 7.5
# Shared helpers for the Enable Banking spike scripts. Dot-source it: . "$PSScriptRoot/eb-client.ps1"
# Never prints the private key or the JWT. PowerShell 7.5+ for ConvertFrom-Json -DateKind.

$script:EbApiBase = 'https://api.enablebanking.com'
$script:EbApplicationId = '469fb438-ada6-4831-9498-70a1890097d6'   # non-secret (README § Identifiers)
$script:EbKeyPath = Join-Path $PSScriptRoot "secrets/$script:EbApplicationId.pem"

function ConvertTo-Base64Url([byte[]] $Bytes) {
    [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# JWT as specified in the Enable Banking API reference § Authentication (verified 2026-11-04):
# header typ/alg/kid, body iss/aud/iat/exp, RS256 only, TTL at most 86400 s.
function New-EbJwt([int] $TtlSeconds = 3600) {
    if (-not (Test-Path -LiteralPath $script:EbKeyPath)) {
        throw "Private key not found: $script:EbKeyPath"
    }
    $iat = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $header = [ordered]@{ typ = 'JWT'; alg = 'RS256'; kid = $script:EbApplicationId } | ConvertTo-Json -Compress
    $body = [ordered]@{ iss = 'enablebanking.com'; aud = 'api.enablebanking.com'; iat = $iat; exp = $iat + $TtlSeconds } | ConvertTo-Json -Compress
    $signingInput = (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($header))) + '.' +
                    (ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($body)))
    $rsa = [Security.Cryptography.RSA]::Create()
    try {
        $rsa.ImportFromPem((Get-Content -Raw -LiteralPath $script:EbKeyPath))
        $signature = $rsa.SignData(
            [Text.Encoding]::ASCII.GetBytes($signingInput),
            [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    }
    finally {
        $rsa.Dispose()
    }
    "$signingInput.$(ConvertTo-Base64Url $signature)"
}

# Calls the API and returns @{ Status = <int>; Raw = <response text>; Body = <parsed JSON> }.
# Dates stay strings exactly as sent. Does not throw on HTTP errors.
function Invoke-EbApi {
    param(
        [string] $Method = 'GET',
        [Parameter(Mandatory)] [string] $Path,
        [hashtable] $Query,
        $Body,
        [hashtable] $Headers = @{}
    )
    $uri = $script:EbApiBase + $Path
    if ($Query) {
        $pairs = $Query.GetEnumerator() | ForEach-Object { "$($_.Key)=$([Uri]::EscapeDataString([string]$_.Value))" }
        $uri += '?' + ($pairs -join '&')
    }
    $request = @{
        Method             = $Method
        Uri                = $uri
        Headers            = @{ Authorization = "Bearer $(New-EbJwt)"; Accept = 'application/json' } + $Headers
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $Body) {
        $request.Body = $Body | ConvertTo-Json -Depth 10 -Compress
        $request.ContentType = 'application/json'
    }
    $response = Invoke-WebRequest @request
    $raw = [string]$response.Content
    $parsed = $null
    if ($raw) {
        try { $parsed = $raw | ConvertFrom-Json -DateKind String } catch { $parsed = $raw }
    }
    @{ Status = [int]$response.StatusCode; Raw = $raw; Body = $parsed }
}
