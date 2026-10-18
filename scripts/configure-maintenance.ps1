param([string]$ConfigPath = 'output/cloudbaserc.development.json')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$envId = 'cloud1-6gjewz7jf1fbf260'
$functionName = 'lightToolbox'

# Official CloudBase CLI owns authentication. Never print request bodies,
# function environment values or raw provider error responses containing them.
function Invoke-TcbJson([string[]]$CliArgs) {
    $raw = & npx --yes --package @cloudbase/cli@3.8.6 tcb @CliArgs --json 2>&1
    $exitCode = $LASTEXITCODE
    $text = $raw -join "`n"
    $start = $text.IndexOf('{')
    if ($start -lt 0) { throw "CloudBase returned no JSON (exit $exitCode). Check CLI login and network." }
    $response = $text.Substring($start) | ConvertFrom-Json -Depth 30
    if ($exitCode -ne 0 -or $response.PSObject.Properties['error']) {
        if ($response.PSObject.Properties['error']) { throw "CloudBase failed: $($response.error.code). See the provider request ID in a local diagnostic run; secret bodies are not printed." }
        throw "CloudBase failed (exit $exitCode)."
    }
    return $response.data
}
function Get-Function {
    return Invoke-TcbJson -CliArgs @('fn','detail',$functionName,'-e',$envId)
}
function Wait-FunctionReady {
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
        $detail = Get-Function
        if ($detail.Status -eq 'Active') { return $detail }
        if ($detail.Status -notin @('Updating','Creating')) { throw "Function state: $($detail.Status)" }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Function update timed out; no further writes were attempted.' }
        Write-Host "Waiting for function state: $($detail.Status)"
        Start-Sleep -Seconds 10
    } while ($true)
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -Depth 20
if ($config.envId -ne $envId) { throw 'Unexpected target environment.' }
$localFunction = @($config.functions | Where-Object name -eq $functionName)
if ($localFunction.Count -ne 1) { throw 'Expected exactly one lightToolbox configuration.' }
$vars = $localFunction[0].envVariables
$detail = Wait-FunctionReady
$remote = @{}
foreach ($entry in $detail.Environment.Variables) { $remote[$entry.Key] = $entry.Value }
$localToken = if ($vars.PSObject.Properties['LIGHT_MAINTENANCE_TOKEN']) { $vars.LIGHT_MAINTENANCE_TOKEN } else { $null }
if ($remote.ContainsKey('LIGHT_MAINTENANCE_TOKEN') -and $localToken -and $remote.LIGHT_MAINTENANCE_TOKEN -ne $localToken) {
    throw 'Maintenance tokens differ. Resolve the intended secret locally before changing the timer.'
}
$token = if ($localToken) { $localToken } elseif ($remote.ContainsKey('LIGHT_MAINTENANCE_TOKEN')) { $remote.LIGHT_MAINTENANCE_TOKEN } else {
    [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
}
if ($token -notmatch '^[a-f0-9]{64}$') { throw 'Expected a 256-bit hexadecimal maintenance token.' }
$vars | Add-Member -NotePropertyName LIGHT_MAINTENANCE_TOKEN -NotePropertyValue $token -Force
$config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
if (-not $remote.ContainsKey('LIGHT_MAINTENANCE_TOKEN')) {
    $remote.LIGHT_MAINTENANCE_TOKEN = $token
    $variables = @($remote.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })
    $body = @{FunctionName=$functionName;Namespace=$envId;Environment=@{Variables=$variables}} | ConvertTo-Json -Compress -Depth 8
    $null = Invoke-TcbJson -CliArgs @('api','scf','UpdateFunctionConfiguration','--body',$body,'-r','ap-shanghai')
    $detail = Wait-FunctionReady
}
if (-not @($detail.Triggers | Where-Object TriggerName -eq 'lightMaintenance').Count) {
    throw 'lightMaintenance trigger is missing. Create the named timer before configuring it.'
}
$body = @{FunctionName=$functionName;Namespace=$envId;TriggerName='lightMaintenance';Type='timer';CustomArgument=$token;TriggerDesc='0 */5 * * * * *';Enable='OPEN'} | ConvertTo-Json -Compress
$null = Invoke-TcbJson -CliArgs @('api','scf','UpdateTrigger','--body',$body,'-r','ap-shanghai')
$context = @{Type='Timer';Message=$token} | ConvertTo-Json -Compress
$body = @{FunctionName=$functionName;Namespace=$envId;InvocationType='RequestResponse';ClientContext=$context} | ConvertTo-Json -Compress
$invocation = Invoke-TcbJson -CliArgs @('api','scf','Invoke','--body',$body,'-r','ap-shanghai')
if ($invocation.Result.InvokeResult -ne 0) { throw 'Maintenance invocation failed. Inspect cloud.request.failed with the provider request ID.' }
$result = $invocation.Result.RetMsg | ConvertFrom-Json
if ($result.PSObject.Properties['errorCode']) { throw "Maintenance code failed: $($result.errorCode), requestId=$($result.requestId). Inspect cloud.request.failed in function logs." }
if (-not $result.PSObject.Properties['ok'] -or -not $result.ok) { throw 'Maintenance returned an unsuccessful or malformed result.' }
[ordered]@{ok=$true;environment=$envId;function=$functionName;timer='lightMaintenance';cron='0 */5 * * * * *';requestId=$result.requestId;maintenance=$result.data} | ConvertTo-Json -Depth 8
