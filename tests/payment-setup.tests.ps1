$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path $PSScriptRoot -Parent
$setupScript = Join-Path $projectRoot 'scripts/configure-payment.ps1'
$testDirectory = Join-Path $projectRoot ('output/payment-setup-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$credentialsPath = Join-Path $testDirectory 'credentials.env'
$pushPath = Join-Path $testDirectory 'push.env'
# Inert synthetic credentials only; the fake npx below forbids all network access.
$fakeSecret = 'a' * 32
$fakeKey = 'b' * 32
$fakeAes = 'c' * 43
$paymentText = "WECHAT_APP_SECRET=$fakeSecret`nXPAY_OFFER_ID=123456`nXPAY_APP_KEY=$fakeKey`nXPAY_PRODUCT_SINGLE=`nXPAY_PRODUCT_MONTH=`nWECHAT_ORIGINAL_ID=gh_test`nXPAY_IOS_ENABLED=true"
$paymentText | Set-Content -LiteralPath $credentialsPath
"WECHAT_PUSH_TOKEN=syntheticCallbackToken`nWECHAT_PUSH_AES_KEY=$fakeAes`nUNRELATED_LOCAL_SECRET=must-not-upload" | Set-Content -LiteralPath $pushPath
$global:LIGHTPaymentSetupTestState = @{calls=0;updates=0;providerError=$false;corruptReadback=$false;remoteVariables=@(
    @{Key='LIGHT_MODE';Value='development'},
    @{Key='LIGHT_TEST_OPENIDS';Value='synthetic-user'},
    @{Key='LIGHT_MAINTENANCE_TOKEN';Value=('m' * 64)},
    @{Key='TENCENT_SECRET_KEY';Value='synthetic-preserved-portrait'},
    @{Key='XPAY_PRODUCT_SINGLE';Value='existing-single'}
)}
function global:npx {
    $state = $global:LIGHTPaymentSetupTestState
    $state.calls++
    $global:LASTEXITCODE = 0
    if ($args -contains 'detail') {
        return (@{data=@{FunctionName='lightToolbox';Status='Active';Runtime='Nodejs20.19';Role='TCB_QcsRole';Timeout=120;MemorySize=1024;Environment=@{Variables=$state.remoteVariables};Triggers=@(@{TriggerName='lightMaintenance';CustomArgument=('m' * 64)})}} | ConvertTo-Json -Compress -Depth 10)
    }
    if ($args -contains 'UpdateFunctionConfiguration') {
        $bodyIndex = [Array]::IndexOf($args, '--body')
        $body = $args[$bodyIndex + 1] | ConvertFrom-Json -Depth 10
        if ($body.Namespace -ne 'cloud1-6gjewz7jf1fbf260' -or $body.FunctionName -ne 'lightToolbox') { throw 'Wrong mutation target.' }
        if ($state.providerError) {
            $global:LASTEXITCODE = 5
            return (@{error=@{code='AuthFailure';message=($args[$bodyIndex + 1]);requestId='00000000-0000-0000-0000-000000000000'}} | ConvertTo-Json -Depth 12 -Compress)
        }
        $state.remoteVariables = $body.Environment.Variables
        if ($state.corruptReadback) { ($state.remoteVariables | Where-Object Key -eq 'TENCENT_SECRET_KEY').Value = 'unexpected' }
        $state.updates++
        return '{"data":{"RequestId":"synthetic-update"}}'
    }
    throw 'Unexpected external command; network calls are forbidden.'
}
function Assert-Rejected([string]$Expected, [switch]$BeforeCloud) {
    $callsBefore = $global:LIGHTPaymentSetupTestState.calls
    $updatesBefore = $global:LIGHTPaymentSetupTestState.updates
    $message = ''
    try { $null = & $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -Apply }
    catch { $message = $_.Exception.Message }
    if ($message -notlike $Expected) { throw "Expected rejection: $Expected." }
    if ($BeforeCloud -and $global:LIGHTPaymentSetupTestState.calls -ne $callsBefore) { throw 'Invalid input reached the cloud.' }
    if ($global:LIGHTPaymentSetupTestState.updates -ne $updatesBefore) { throw 'Rejected request mutated configuration.' }
    if ($message.Contains($fakeSecret) -or $message.Contains($fakeKey) -or $message.Contains($fakeAes)) { throw 'Secret appeared in exception.' }
}
try {
    $check = (& $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath) -join "`n" | ConvertFrom-Json
    if (-not $check.ok -or $check.applied -or $check.paymentEnabled -or $check.missingProductKeys.Count -ne 2 -or $global:LIGHTPaymentSetupTestState.updates) { throw 'Invalid read-only staging summary.' }
    $output = (& $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -Apply) -join "`n"
    $result = $output | ConvertFrom-Json
    if (-not $result.applied -or -not $result.iosEnabled -or $result.mode -ne 'development' -or $global:LIGHTPaymentSetupTestState.updates -ne 1) { throw 'Expected one staging update with payment disabled.' }
    foreach ($secret in @($fakeSecret,$fakeKey,$fakeAes,'synthetic-preserved-portrait')) {
        if ($output.Contains($secret)) { throw 'Secret appeared in output.' }
    }
    $vars = $global:LIGHTPaymentSetupTestState.remoteVariables
    if (($vars | Where-Object Key -eq 'TENCENT_SECRET_KEY').Value -ne 'synthetic-preserved-portrait') { throw 'Portrait credential was lost.' }
    if (($vars | Where-Object Key -eq 'XPAY_PRODUCT_SINGLE').Value -ne 'existing-single') { throw 'Missing local product erased a remote ID.' }
    if (@($vars | Where-Object Key -in @('UNRELATED_LOCAL_SECRET','LIGHT_PAYMENT_VERIFIED')).Count) { throw 'Unrelated local secret or payment verification flag was uploaded.' }
    $null = & $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -Apply
    if ($global:LIGHTPaymentSetupTestState.updates -ne 1) { throw 'Idempotent apply updated configuration.' }
    ($paymentText -replace "XPAY_APP_KEY=$fakeKey", 'XPAY_APP_KEY=') | Set-Content -LiteralPath $credentialsPath
    Assert-Rejected 'Missing XPAY_APP_KEY*' -BeforeCloud
    ($paymentText + "`nXPAY_APP_KEY=$fakeKey") | Set-Content -LiteralPath $credentialsPath
    Assert-Rejected 'Duplicate configuration field*' -BeforeCloud
    ($paymentText -replace 'XPAY_PRODUCT_SINGLE=', 'XPAY_PRODUCT_SINGLE=same' -replace 'XPAY_PRODUCT_MONTH=', 'XPAY_PRODUCT_MONTH=same') | Set-Content -LiteralPath $credentialsPath
    Assert-Rejected 'The two products must have distinct*' -BeforeCloud
    $paymentText | Set-Content -LiteralPath $credentialsPath
    ($vars | Where-Object Key -eq 'LIGHT_MODE').Value = 'production'
    Assert-Rejected 'Payment staging is restricted*'
    ($vars | Where-Object Key -eq 'LIGHT_MODE').Value = 'development'
    ($vars | Where-Object Key -eq 'WECHAT_PUSH_TOKEN').Value = 'differentCallbackToken'
    Assert-Rejected 'Existing WECHAT_PUSH_TOKEN differs*'
    ($vars | Where-Object Key -eq 'WECHAT_PUSH_TOKEN').Value = 'syntheticCallbackToken'
    ($paymentText -replace 'XPAY_OFFER_ID=123456', 'XPAY_OFFER_ID=123457') | Set-Content -LiteralPath $credentialsPath
    $global:LIGHTPaymentSetupTestState.providerError = $true
    Assert-Rejected 'CloudBase failed: AuthFailure*'
    $global:LIGHTPaymentSetupTestState.providerError = $false
    $global:LIGHTPaymentSetupTestState.corruptReadback = $true
    $mismatch = $false
    try { $null = & $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -Apply }
    catch { $mismatch = $_.Exception.Message -eq 'Existing configuration changed unexpectedly: TENCENT_SECRET_KEY.' }
    if (-not $mismatch) { throw 'Readback corruption was not detected.' }
    $global:LIGHTPaymentSetupTestState.corruptReadback = $false
    ($global:LIGHTPaymentSetupTestState.remoteVariables | Where-Object Key -eq 'TENCENT_SECRET_KEY').Value = 'synthetic-preserved-portrait'
    $paymentText | Set-Content -LiteralPath $credentialsPath
    $callsBefore = $global:LIGHTPaymentSetupTestState.calls
    $rejected = $false
    try { $null = & $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -EnableVerification -Apply }
    catch { $rejected = $_.Exception.Message -like 'Verification requires both published product IDs*' }
    if (-not $rejected -or $global:LIGHTPaymentSetupTestState.calls -ne $callsBefore) { throw 'Incomplete verification reached the cloud.' }
    ($paymentText -replace 'XPAY_PRODUCT_SINGLE=', 'XPAY_PRODUCT_SINGLE=single' -replace 'XPAY_PRODUCT_MONTH=', 'XPAY_PRODUCT_MONTH=month') | Set-Content -LiteralPath $credentialsPath
    $verify = (& $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -EnableVerification -Apply) -join "`n" | ConvertFrom-Json
    if ($verify.mode -ne 'verification' -or -not $verify.paymentEnabled -or -not $verify.existingConfigurationPreserved) { throw 'Verification mode was not validated.' }
    $count = $global:LIGHTPaymentSetupTestState.updates
    $null = & $setupScript -CredentialsPath $credentialsPath -PushConfigPath $pushPath -EnableVerification -Apply
    if ($global:LIGHTPaymentSetupTestState.updates -ne $count) { throw 'Verification reapply was not idempotent.' }
    $vars = $global:LIGHTPaymentSetupTestState.remoteVariables
    if (($vars | Where-Object Key -eq 'LIGHT_TEST_OPENIDS').Value -ne 'synthetic-user' -or @($vars | Where-Object Key -eq 'LIGHT_PAYMENT_VERIFIED').Count) { throw 'Verification changed public access gates.' }
    'PASS: staging, preservation, idempotency, missing products, invalid input, production/rotation refusal, secret-safe provider errors, readback corruption.'
} finally {
    Remove-Item Function:\npx
    Remove-Variable LIGHTPaymentSetupTestState -Scope Global
}
