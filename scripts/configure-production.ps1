param(
    [Parameter(Mandatory)][ValidateRange(100,2147483647)][int]$SingleFen,
    [Parameter(Mandatory)][ValidateRange(100,2147483647)][int]$MonthFen,
    [switch]$WechatPricesConfirmed,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
if ($Apply -and -not $WechatPricesConfirmed) { throw 'Confirm the published WeChat product prices before applying production configuration.' }
$envId = 'cloud1-6gjewz7jf1fbf260'
$functionName = 'lightToolbox'
. (Join-Path $PSScriptRoot 'cloud-config-tools.ps1')
$before = Wait-Ready
$original = Read-Variables $before
if ($original['LIGHT_MODE'] -cnotin @('verification','production')) { throw 'Production transition requires an existing configured payment deployment.' }
foreach ($key in @('WECHAT_APP_SECRET','XPAY_OFFER_ID','XPAY_APP_KEY','XPAY_PRODUCT_SINGLE','XPAY_PRODUCT_MONTH','WECHAT_PUSH_TOKEN','WECHAT_PUSH_AES_KEY','WECHAT_ORIGINAL_ID','LIGHT_MAINTENANCE_TOKEN')) {
    if (-not $original.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($original[$key])) { throw "Missing required existing configuration: $key." }
}
if ($original['XPAY_PRODUCT_SINGLE'] -ceq $original['XPAY_PRODUCT_MONTH']) { throw 'Payment product IDs must differ.' }
$changes = @{LIGHT_MODE='production';LIGHT_PRODUCTION_ENABLED='true';LIGHT_PRICE_SINGLE_FEN=[string]$SingleFen;LIGHT_PRICE_MONTH_FEN=[string]$MonthFen}
$changedKeys = @($changes.Keys | Sort-Object | Where-Object { -not $original.ContainsKey($_) -or $original[$_] -cne $changes[$_] })
$summary = [ordered]@{ok=$true;applied=$false;previousMode=$original['LIGHT_MODE'];targetMode='production';prices=@{singleFen=$SingleFen;monthFen=$MonthFen};changedKeys=$changedKeys;paymentAcceptanceFlagUnchanged=$true}
if (-not $Apply) { $summary | ConvertTo-Json -Depth 4; return }
$merged = $original.Clone()
foreach ($key in $changes.Keys) { $merged[$key]=$changes[$key] }
if ($changedKeys.Count) {
    $variables = @($merged.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })
    $body = @{FunctionName=$functionName;Namespace=$envId;Environment=@{Variables=$variables}} | ConvertTo-Json -Compress -Depth 8
    $null = Invoke-TcbJson -CliArgs @('api','scf','UpdateFunctionConfiguration','--api-version','2018-04-16','--body',$body,'-r','ap-shanghai')
}
$after = Wait-Ready
$actual = Read-Variables $after
if ($actual.Count -ne $merged.Count) { throw 'Unexpected environment variable count after production update.' }
foreach ($key in $merged.Keys) {
    if (-not $actual.ContainsKey($key) -or $actual[$key] -cne $merged[$key]) { throw "Configuration readback mismatch: $key." }
}
foreach ($field in @('Runtime','Role','Timeout','MemorySize')) {
    if ($before.$field -cne $after.$field) { throw "Function setting changed unexpectedly: $field." }
}
if (($before.Triggers | ConvertTo-Json -Compress -Depth 10) -cne ($after.Triggers | ConvertTo-Json -Compress -Depth 10)) { throw 'Trigger configuration changed unexpectedly.' }
$summary.applied=$true
$summary.existingConfigurationPreserved=$true
$summary.status=$after.Status
$summary | ConvertTo-Json -Depth 4
