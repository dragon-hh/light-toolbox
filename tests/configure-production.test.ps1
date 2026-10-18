$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$global:lightProductionTest = @{updates=0;requests=0;corrupt=$false}
$values = @{LIGHT_MODE='verification';LIGHT_TEST_OPENIDS='synthetic-tester';LIGHT_PAYMENT_VERIFIED='false';LIGHT_PRICE_SINGLE_FEN='100';LIGHT_PRICE_MONTH_FEN='110';XPAY_PRODUCT_SINGLE='one';XPAY_PRODUCT_MONTH='month'}
foreach ($key in @('WECHAT_APP_SECRET','XPAY_OFFER_ID','XPAY_APP_KEY','WECHAT_PUSH_TOKEN','WECHAT_PUSH_AES_KEY','WECHAT_ORIGINAL_ID','LIGHT_MAINTENANCE_TOKEN','TENCENT_SECRET_KEY')) { $values[$key]='synthetic-secret' }
$global:lightProductionTest.remote = @{
    FunctionName='lightToolbox';Status='Active';Runtime='Nodejs20.19';Role='unchanged-role';Timeout=120;MemorySize=1024
    Triggers=@(@{TriggerName='cleanup';CustomArgument='synthetic-timer-secret'})
    Environment=@{Variables=@($values.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })}
}
function npx {
    $global:lightProductionTest.requests++
    $global:LASTEXITCODE=0
    $cli=@($args)
    if ($cli -contains 'detail') {
        $copy=$global:lightProductionTest.remote | ConvertTo-Json -Depth 12 | ConvertFrom-Json -Depth 12
        if ($global:lightProductionTest.corrupt) { ($copy.Environment.Variables | Where-Object Key -eq 'LIGHT_PRICE_MONTH_FEN').Value='999' }
        return @{data=$copy} | ConvertTo-Json -Depth 15
    }
    if ($cli -contains 'UpdateFunctionConfiguration') {
        $body=$cli[[array]::IndexOf($cli,'--body')+1] | ConvertFrom-Json -Depth 12
        if ($body.FunctionName -cne 'lightToolbox' -or $body.Namespace -cne 'cloud1-6gjewz7jf1fbf260') { throw 'Wrong update target.' }
        $global:lightProductionTest.updates++
        $global:lightProductionTest.remote.Environment=$body.Environment
        return '{"data":{"ok":true}}'
    }
    throw 'Unexpected CLI operation.'
}
$target=Join-Path $PSScriptRoot '../scripts/configure-production.ps1'
$rejected=$false
try { $null=& $target -SingleFen 100 -MonthFen 990 -Apply } catch { $rejected=$_.Exception.Message -match 'Confirm the published' }
if (-not $rejected -or $global:lightProductionTest.requests -ne 0) { throw 'Unconfirmed platform prices reached the cloud.' }
$dry=(& $target -SingleFen 100 -MonthFen 990) -join "`n"
if ($global:lightProductionTest.updates -ne 0 -or $dry.Contains('synthetic-')) { throw 'Dry run wrote data or leaked private values.' }
$output=(& $target -SingleFen 100 -MonthFen 990 -WechatPricesConfirmed -Apply) -join "`n"
$receipt=$output | ConvertFrom-Json
if (-not $receipt.applied -or -not $receipt.existingConfigurationPreserved -or $output.Contains('synthetic-')) { throw 'Apply failed or leaked private values.' }
$actual=@{}
foreach ($entry in $global:lightProductionTest.remote.Environment.Variables) { $actual[$entry.Key]=$entry.Value }
if ($actual.LIGHT_MODE -cne 'production' -or $actual.LIGHT_PRODUCTION_ENABLED -cne 'true' -or $actual.LIGHT_PRICE_MONTH_FEN -cne '990') { throw 'Production settings not applied.' }
foreach ($key in $values.Keys | Where-Object {$_ -cnotin @('LIGHT_MODE','LIGHT_PRICE_MONTH_FEN')}) {
    if ($actual[$key] -cne $values[$key]) { throw 'Unrelated config changed.' }
}
$null=& $target -SingleFen 100 -MonthFen 990 -WechatPricesConfirmed -Apply
if ($global:lightProductionTest.updates -ne 1) { throw 'Idempotent apply wrote twice.' }
$global:lightProductionTest.corrupt=$true
$rejected=$false
try { $null=& $target -SingleFen 100 -MonthFen 990 -WechatPricesConfirmed -Apply } catch { $rejected=$_.Exception.Message -match 'readback mismatch' }
if (-not $rejected) { throw 'Readback mismatch was hidden.' }
'Production config: confirmation gate, dry run, merge, preservation of acceptance evidence, idempotency, redaction and failed readback passed.'
