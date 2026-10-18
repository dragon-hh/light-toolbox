param([string]$CredentialsPath = '.env.payment', [string]$PushConfigPath = '.env', [switch]$EnableVerification, [switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$envId = 'cloud1-6gjewz7jf1fbf260'
$functionName = 'lightToolbox'
$paymentKeys = @('WECHAT_APP_SECRET', 'XPAY_OFFER_ID', 'XPAY_APP_KEY', 'XPAY_PRODUCT_SINGLE', 'XPAY_PRODUCT_MONTH', 'WECHAT_ORIGINAL_ID', 'XPAY_IOS_ENABLED')
$productKeys = @('XPAY_PRODUCT_SINGLE', 'XPAY_PRODUCT_MONTH')
$pushKeys = @('WECHAT_PUSH_TOKEN', 'WECHAT_PUSH_AES_KEY')

function Read-EnvFile([string]$Path, [string[]]$AllowedKeys = @()) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Required local configuration file does not exist.' }
    $result = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
        if ($line -notmatch '^([A-Z][A-Z0-9_]*)=(.*)$') { throw 'Invalid configuration entry; use unquoted KEY=value lines.' }
        $name = $Matches[1]
        $value = $Matches[2]
        if ($AllowedKeys.Count -and $name -notin $AllowedKeys) { throw 'Unexpected field in payment credentials file.' }
        if ($result.ContainsKey($name)) { throw "Duplicate configuration field: $name." }
        $result[$name] = $value
    }
    return $result
}
. (Join-Path $PSScriptRoot 'cloud-config-tools.ps1')

$credentials = Read-EnvFile $CredentialsPath $paymentKeys
$pushConfig = Read-EnvFile $PushConfigPath
foreach ($name in $paymentKeys | Where-Object { $_ -notin $productKeys }) {
    if (-not $credentials.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($credentials[$name])) { throw "Missing $name; no cloud change attempted." }
}
foreach ($name in $pushKeys) {
    if (-not $pushConfig.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($pushConfig[$name])) { throw "Missing $name; preserve the existing push configuration instead of regenerating keys." }
    $credentials[$name] = $pushConfig[$name]
}
foreach ($name in $credentials.Keys) {
    if ($credentials[$name] -match '[\s\x00-\x1f"'']') { throw "Invalid unquoted value format: $name." }
}
if ($credentials.WECHAT_APP_SECRET -notmatch '^[a-fA-F0-9]{32}$') { throw 'Invalid WECHAT_APP_SECRET format.' }
if ($credentials.XPAY_OFFER_ID -notmatch '^[0-9]+$') { throw 'Invalid XPAY_OFFER_ID format.' }
if ($credentials.WECHAT_ORIGINAL_ID -notmatch '^gh_[A-Za-z0-9]+$') { throw 'Invalid WECHAT_ORIGINAL_ID format.' }
if ($credentials.XPAY_IOS_ENABLED -cnotin @('true', 'false')) { throw 'XPAY_IOS_ENABLED must be true or false.' }
if ($credentials.WECHAT_PUSH_TOKEN -notmatch '^[A-Za-z0-9]{3,32}$') { throw 'Invalid WECHAT_PUSH_TOKEN format.' }
if ($credentials.WECHAT_PUSH_AES_KEY -notmatch '^[A-Za-z0-9+/]{43}$') { throw 'Invalid WECHAT_PUSH_AES_KEY format.' }
$missingProducts = @($productKeys | Where-Object { -not $credentials.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($credentials[$_]) })
if ($missingProducts.Count -eq 0 -and $credentials.XPAY_PRODUCT_SINGLE -ceq $credentials.XPAY_PRODUCT_MONTH) { throw 'The two products must have distinct published IDs.' }
# Default: stage credentials without enabling purchases. Explicit verification
# requires both products and preserves the tester allowlist; never enables public
# production or asserts that real payment acceptance has passed.
if ($EnableVerification -and $missingProducts.Count) { throw 'Verification requires both published product IDs; no cloud change attempted.' }
foreach ($name in $missingProducts) { $credentials.Remove($name) }
$before = Wait-Ready
$original = Read-Variables $before
if ($original.LIGHT_MODE -cne 'development' -and -not ($EnableVerification -and $original.LIGHT_MODE -ceq 'verification')) { throw 'Payment staging is restricted to the existing development deployment.' }
if (-not $original.LIGHT_TEST_OPENIDS) { throw 'A nonempty tester allowlist is required.' }
if ($EnableVerification) { $credentials.LIGHT_MODE = 'verification' }
foreach ($name in $pushKeys) {
    if ($original.ContainsKey($name) -and $original[$name] -cne $credentials[$name]) { throw "Existing $name differs; refusing to rotate callback credentials." }
}
$changed = @($credentials.Keys | Sort-Object | Where-Object { -not $original.ContainsKey($_) -or $original[$_] -cne $credentials[$_] })
$summary = [ordered]@{ok=$true;applied=$false;environment=$envId;function=$functionName;mode=$(if ($EnableVerification) {'verification'} else {'development'});iosEnabled=($credentials.XPAY_IOS_ENABLED -ceq 'true');changedKeys=$changed;missingProductKeys=$missingProducts;paymentEnabled=[bool]$EnableVerification}
if (-not $Apply) { $summary | ConvertTo-Json -Depth 4; return }
if ($changed.Count) {
    $merged = $original.Clone()
    foreach ($name in $credentials.Keys) { $merged[$name] = $credentials[$name] }
    $variables = @($merged.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })
    $body = @{FunctionName=$functionName;Namespace=$envId;Environment=@{Variables=$variables}} | ConvertTo-Json -Compress -Depth 8
    $null = Invoke-TcbJson -CliArgs @('api', 'scf', 'UpdateFunctionConfiguration', '--api-version', '2018-04-16', '--body', $body, '-r', 'ap-shanghai')
}
$after = Wait-Ready
$actual = Read-Variables $after
foreach ($name in $credentials.Keys) {
    if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $credentials[$name]) { throw "Configuration readback mismatch: $name." }
}
foreach ($name in $original.Keys | Where-Object { -not $credentials.ContainsKey($_) }) {
    if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $original[$name]) { throw "Existing configuration changed unexpectedly: $name." }
}
foreach ($field in @('Runtime', 'Role', 'Timeout', 'MemorySize')) {
    if ($before.$field -cne $after.$field) { throw "Function configuration changed unexpectedly: $field." }
}
if (($before.Triggers | ConvertTo-Json -Compress -Depth 10) -cne ($after.Triggers | ConvertTo-Json -Compress -Depth 10)) { throw 'Trigger configuration changed unexpectedly.' }
$summary.applied = $true
$summary.existingConfigurationPreserved = $true
$summary | ConvertTo-Json -Depth 4
