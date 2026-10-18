$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$global:lightPriceTestState = @{}
$global:lightPriceTestState.updates = 0
$global:lightPriceTestState.requests = 0
$global:lightPriceTestState.corruptReadback = $false
$global:lightPriceTestState.remote = @{
    FunctionName='lightToolbox'; Status='Active'; Runtime='Nodejs20.19'; Role='unchanged-role'; Timeout=60; MemorySize=512
    Triggers=@(@{TriggerName='cleanup';CustomArgument='synthetic-maintenance-secret'})
    Environment=@{Variables=@(@{Key='LIGHT_MODE';Value='verification'},@{Key='XPAY_APP_KEY';Value='synthetic-payment-secret'},@{Key='LIGHT_TEST_OPENIDS';Value='synthetic-tester'})}
}
function npx {
    $global:lightPriceTestState.requests++
    $cli = @($args)
    $global:LASTEXITCODE = 0
    if ($cli -contains 'detail') {
        $copy = $global:lightPriceTestState.remote | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
        if ($global:lightPriceTestState.corruptReadback -and $global:lightPriceTestState.updates -gt 1) {
            ($copy.Environment.Variables | Where-Object Key -eq 'LIGHT_PRICE_MONTH_FEN').Value = '999'
        }
        return @{data=$copy} | ConvertTo-Json -Depth 15
    }
    if ($cli -contains 'UpdateFunctionConfiguration') {
        $body = $cli[[array]::IndexOf($cli,'--body')+1] | ConvertFrom-Json -Depth 12
        if ($body.FunctionName -ne 'lightToolbox' -or $body.Namespace -ne 'cloud1-6gjewz7jf1fbf260') { throw 'Wrong update target.' }
        $global:lightPriceTestState.updates++
        $global:lightPriceTestState.remote.Environment = $body.Environment
        return '{"data":{"ok":true}}'
    }
    throw 'Unexpected CLI call in isolated test.'
}
$target = Join-Path $PSScriptRoot '../scripts/configure-prices.ps1'
$dry = (& $target -SingleFen 100 -MonthFen 110) -join "`n"
if ($global:lightPriceTestState.updates -ne 0 -or $dry.Contains('synthetic-')) { throw 'Dry run wrote data or exposed private configuration.' }
$applied = (& $target -SingleFen 100 -MonthFen 110 -Apply) -join "`n"
$result = $applied | ConvertFrom-Json
if (-not $result.applied -or -not $result.existingConfigurationPreserved -or $global:lightPriceTestState.updates -ne 1 -or $applied.Contains('synthetic-')) { throw 'Failed apply or leaked secret.' }
$vars = @{}
foreach ($v in $global:lightPriceTestState.remote.Environment.Variables) { $vars[$v.Key]=$v.Value }
if ($vars.XPAY_APP_KEY -ne 'synthetic-payment-secret' -or $vars.LIGHT_MODE -ne 'verification' -or $vars.LIGHT_TEST_OPENIDS -ne 'synthetic-tester' -or $vars.ContainsKey('LIGHT_PAYMENT_VERIFIED')) { throw 'Existing settings changed.' }
$null = & $target -SingleFen 100 -MonthFen 110 -Apply
if ($global:lightPriceTestState.updates -ne 1) { throw 'Unchanged prices caused a second update.' }
foreach ($value in @('99','1.1','-100','2147483648')) {
    $before = $global:lightPriceTestState.requests
    $failed = $false
    try { $null = & $target -SingleFen 100 -MonthFen $value -Apply } catch { $failed = $true }
    if (-not $failed -or $global:lightPriceTestState.requests -ne $before) { throw 'Invalid price reached the cloud CLI.' }
}
$global:lightPriceTestState.corruptReadback = $true
$failed = $false
try { $null = & $target -SingleFen 100 -MonthFen 990 -Apply } catch { $failed = $_.Exception.Message -match 'readback mismatch' }
if (-not $failed) { throw 'Readback mismatch passed silently.' }
'Price configuration: dry run, exact merge, idempotency, input checks, secret redaction and readback failure passed.'
