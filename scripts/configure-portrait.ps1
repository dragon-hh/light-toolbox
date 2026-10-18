param([string]$CredentialsPath = '.env.portrait', [switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$envId = 'cloud1-6gjewz7jf1fbf260'
$functionName = 'lightToolbox'
$expectedKeys = @('TENCENT_SECRET_ID', 'TENCENT_SECRET_KEY', 'TENCENT_REGION')

function Invoke-TcbJson([string[]]$CliArgs) {
    # Capture every output stream. Provider errors can contain request bodies;
    # print only a code and request ID, never raw JSON or environment values.
    $raw = & npx --yes --package @cloudbase/cli@3.8.6 tcb @CliArgs --json 2>&1
    $code = $LASTEXITCODE
    $text = $raw -join "`n"
    $start = $text.IndexOf('{')
    if ($start -lt 0) { throw "CloudBase returned no JSON (exit $code)." }
    try { $response = $text.Substring($start) | ConvertFrom-Json -Depth 40 }
    catch { throw "CloudBase returned invalid JSON (exit $code); raw output suppressed." }
    if ($response.PSObject.Properties['error']) {
        $requestId = if ($response.error.PSObject.Properties['requestId']) { $response.error.requestId } else { 'unavailable' }
        throw "CloudBase failed: $($response.error.code), requestId=$requestId."
    }
    if ($code -ne 0 -or -not $response.PSObject.Properties['data']) { throw "CloudBase response failed validation (exit $code)." }
    return $response.data
}
function Read-Variables($Detail) {
    $result = @{}
    foreach ($entry in $Detail.Environment.Variables) {
        if ($result.ContainsKey($entry.Key)) { throw 'Duplicate remote environment variable.' }
        $result[$entry.Key] = $entry.Value
    }
    return $result
}
function Wait-Ready {
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
        $detail = Invoke-TcbJson -CliArgs @('fn', 'detail', $functionName, '-e', $envId)
        if ($detail.FunctionName -ne $functionName) { throw 'Unexpected cloud function.' }
        if ($detail.Status -eq 'Active') { return $detail }
        if ($detail.Status -notin @('Updating', 'Creating')) { throw "Unexpected function status: $($detail.Status)." }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Function update timed out; no further writes attempted.' }
        Write-Host "Waiting for function: $($detail.Status)"
        Start-Sleep -Seconds 10
    } while ($true)
}

if (-not (Test-Path -LiteralPath $CredentialsPath -PathType Leaf)) { throw 'Create the local .env.portrait file first.' }
$credentials = @{}
foreach ($line in Get-Content -LiteralPath $CredentialsPath) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    if ($line -notmatch '^\s*(TENCENT_SECRET_ID|TENCENT_SECRET_KEY|TENCENT_REGION)\s*=(.*)$') { throw 'Unrecognized credential file entry; only the three documented keys are accepted.' }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($credentials.ContainsKey($name)) { throw "Duplicate credential field: $name." }
    $credentials[$name] = $value
}
foreach ($name in $expectedKeys) {
    if (-not $credentials.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($credentials[$name])) { throw "Missing $name in the local credentials file; no cloud change attempted." }
}
if ($credentials.TENCENT_SECRET_ID -notmatch '^AKID[A-Za-z0-9]{12,124}$' -or $credentials.TENCENT_SECRET_KEY -notmatch '^[A-Za-z0-9]{16,128}$') {
    throw 'Invalid permanent API credential format. Paste unquoted values; no cloud change attempted.'
}
if ($credentials.TENCENT_REGION -notin @('ap-guangzhou', 'ap-shanghai', 'ap-beijing')) { throw 'Unsupported portrait region.' }
$before = Wait-Ready
$original = Read-Variables $before
if ($original.LIGHT_MODE -ne 'development') { throw 'This setup script is restricted to the existing development deployment.' }
$changed = @($expectedKeys | Where-Object { -not $original.ContainsKey($_) -or $original[$_] -cne $credentials[$_] })
if (-not $Apply) {
    [ordered]@{ok=$true;applied=$false;environment=$envId;function=$functionName;changedKeys=$changed;preservedKeys=@($original.Keys | Where-Object { $_ -notin $expectedKeys });note='Configuration check only; provider authentication and image processing are not yet verified.'} | ConvertTo-Json -Depth 4
    exit 0
}
if ($changed.Count) {
    $merged = $original.Clone()
    foreach ($name in $expectedKeys) { $merged[$name] = $credentials[$name] }
    $variables = @($merged.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })
    $body = @{FunctionName=$functionName;Namespace=$envId;Environment=@{Variables=$variables}} | ConvertTo-Json -Compress -Depth 8
    $null = Invoke-TcbJson -CliArgs @('api', 'scf', 'UpdateFunctionConfiguration', '--api-version', '2018-04-16', '--body', $body, '-r', 'ap-shanghai')
}
$after = Wait-Ready
$actual = Read-Variables $after
foreach ($name in $expectedKeys) {
    if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $credentials[$name]) { throw "Configuration readback mismatch: $name." }
}
foreach ($name in $original.Keys | Where-Object { $_ -notin $expectedKeys }) {
    if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $original[$name]) { throw "Existing configuration changed unexpectedly: $name." }
}
foreach ($field in @('Runtime', 'Role', 'Timeout', 'MemorySize')) {
    if ($before.$field -cne $after.$field) { throw "Function configuration changed unexpectedly: $field." }
}
if (($before.Triggers | ConvertTo-Json -Compress -Depth 10) -cne ($after.Triggers | ConvertTo-Json -Compress -Depth 10)) { throw 'Trigger configuration changed unexpectedly.' }
[ordered]@{ok=$true;applied=$true;environment=$envId;function=$functionName;changedKeys=$changed;existingConfigurationPreserved=$true;note='Configuration readback passed. Real portrait generation must still be verified.'} | ConvertTo-Json -Depth 4
