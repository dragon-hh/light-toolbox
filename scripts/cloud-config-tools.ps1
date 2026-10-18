# Shared secret-safe CloudBase helpers. Caller supplies $envId and $functionName.
function Invoke-TcbJson([string[]]$CliArgs) {
    # Provider failures may echo the request body: never print raw CLI output.
    $raw = & npx --yes --package @cloudbase/cli@3.8.6 tcb @CliArgs --json 2>&1
    $code = $LASTEXITCODE
    $outputText = $raw -join "`n"
    $start = $outputText.IndexOf('{')
    if ($start -lt 0) { throw "CloudBase returned no JSON (exit $code); raw output suppressed." }
    try { $response = $outputText.Substring($start) | ConvertFrom-Json -Depth 40 }
    catch { throw "CloudBase returned invalid JSON (exit $code); raw output suppressed." }
    if ($response.PSObject.Properties['error']) {
        $errorCode = if ($response.error.code -match '^[A-Za-z0-9_.-]{1,100}$') { $response.error.code } else { 'REDACTED_PROVIDER_ERROR' }
        $requestId = if ($response.error.PSObject.Properties['requestId'] -and $response.error.requestId -match '^[a-f0-9-]{36}$') { $response.error.requestId } else { 'unavailable' }
        throw "CloudBase failed: $errorCode, requestId=$requestId."
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
        if ($detail.Status -notin @('Updating', 'Creating')) { throw 'Unexpected function status; no further writes attempted.' }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Function update timed out; no further writes attempted.' }
        Write-Host 'Waiting for cloud function configuration update.'
        Start-Sleep -Seconds 10
    } while ($true)
}
