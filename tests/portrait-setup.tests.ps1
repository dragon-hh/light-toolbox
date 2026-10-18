$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path $PSScriptRoot -Parent
$setupScript = Join-Path $projectRoot 'scripts/configure-portrait.ps1'
$testDirectory = Join-Path $projectRoot ('output/portrait-setup-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testDirectory
$credentialsPath = Join-Path $testDirectory 'credentials.env'
# These are inert synthetic values. This test never calls an external process.
$fakeId = 'AKID' + ('T' * 32)
$fakeKey = 'K' * 32
"TENCENT_SECRET_ID=$fakeId`nTENCENT_SECRET_KEY=$fakeKey`nTENCENT_REGION=ap-guangzhou" | Set-Content -LiteralPath $credentialsPath
$global:LIGHTPortraitSetupTestState = @{callCount=0;updateCount=0;remoteVariables=@(
    @{Key='LIGHT_MODE';Value='development'},
    @{Key='LIGHT_TEST_OPENIDS';Value='synthetic-user'},
    @{Key='LIGHT_MAINTENANCE_TOKEN';Value=('m' * 64)},
    @{Key='EXISTING_PAYMENT_SECRET';Value='synthetic-preserved-value'}
)}
function global:npx {
    $global:LIGHTPortraitSetupTestState.callCount++
    $global:LASTEXITCODE = 0
    if ($args -contains 'detail') {
        return (@{data=@{FunctionName='lightToolbox';Status='Active';Runtime='Nodejs20.19';Role='TCB_QcsRole';Timeout=120;MemorySize=1024;Environment=@{Variables=$global:LIGHTPortraitSetupTestState.remoteVariables};Triggers=@(@{TriggerName='lightMaintenance';TriggerDesc='0 */5 * * * * *';CustomArgument=('m' * 64)})}} | ConvertTo-Json -Compress -Depth 10)
    }
    if ($args -contains 'UpdateFunctionConfiguration') {
        $bodyIndex = [Array]::IndexOf($args, '--body')
        $body = $args[$bodyIndex + 1] | ConvertFrom-Json -Depth 10
        if ($body.Namespace -ne 'cloud1-6gjewz7jf1fbf260' -or $body.FunctionName -ne 'lightToolbox') { throw 'Wrong mutation target.' }
        $global:LIGHTPortraitSetupTestState.remoteVariables = $body.Environment.Variables
        $global:LIGHTPortraitSetupTestState.updateCount++
        return '{"data":{"RequestId":"synthetic-update-request"}}'
    }
    throw 'Unexpected external command; network calls are forbidden in this test.'
}
try {
    $check = (& $setupScript -CredentialsPath $credentialsPath) -join "`n" | ConvertFrom-Json
    if (-not $check.ok -or $check.applied -or $global:LIGHTPortraitSetupTestState.updateCount -ne 0) { throw 'Read-only check mutated remote configuration.' }
    $output = (& $setupScript -CredentialsPath $credentialsPath -Apply) -join "`n"
    $result = $output | ConvertFrom-Json
    if (-not $result.ok -or -not $result.applied -or $global:LIGHTPortraitSetupTestState.updateCount -ne 1) { throw 'Expected exactly one verified configuration update.' }
    if ($output.Contains($fakeId) -or $output.Contains($fakeKey) -or $output.Contains('synthetic-preserved-value')) { throw 'Secret appeared in command output.' }
    $preserved = @($global:LIGHTPortraitSetupTestState.remoteVariables | Where-Object Key -eq 'EXISTING_PAYMENT_SECRET')
    if ($preserved.Count -ne 1 -or $preserved[0].Value -ne 'synthetic-preserved-value') { throw 'Existing secret was not preserved.' }
    $null = & $setupScript -CredentialsPath $credentialsPath -Apply
    if ($global:LIGHTPortraitSetupTestState.updateCount -ne 1) { throw 'Idempotent apply performed an unnecessary update.' }
    "TENCENT_SECRET_ID=$fakeId`nTENCENT_SECRET_KEY=`nTENCENT_REGION=ap-guangzhou" | Set-Content -LiteralPath $credentialsPath
    $callsBefore = $global:LIGHTPortraitSetupTestState.callCount
    $rejected = $false
    try { $null = & $setupScript -CredentialsPath $credentialsPath -Apply }
    catch { $rejected = $_.Exception.Message -like 'Missing TENCENT_SECRET_KEY*' }
    if (-not $rejected -or $global:LIGHTPortraitSetupTestState.callCount -ne $callsBefore) { throw 'Missing credentials were not rejected before cloud access.' }
    Write-Output 'PASS: dry-run, configuration preservation, secret-free output, idempotency, missing-credential rejection.'
} finally {
    Remove-Item Function:\npx
    Remove-Variable LIGHTPortraitSetupTestState -Scope Global
}
