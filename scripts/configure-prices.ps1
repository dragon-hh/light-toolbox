param(
    [Parameter(Mandatory)][ValidatePattern('^[1-9][0-9]*$')][string]$SingleFen,
    [Parameter(Mandatory)][ValidatePattern('^[1-9][0-9]*$')][string]$MonthFen,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$envId = 'cloud1-6gjewz7jf1fbf260'
$functionName = 'lightToolbox'
. (Join-Path $PSScriptRoot 'cloud-config-tools.ps1')
$changes = @{ LIGHT_PRICE_SINGLE_FEN=$SingleFen; LIGHT_PRICE_MONTH_FEN=$MonthFen }
foreach ($key in $changes.Keys) {
    if ([long]$changes[$key] -lt 100 -or [long]$changes[$key] -gt 2147483647) { throw "$key must be integer fen between 100 and 2147483647; no cloud changes attempted." }
}
$before = Wait-Ready
$original = Read-Variables $before
if ($original.LIGHT_MODE -cnotin @('closed','development','verification','production')) { throw 'Unknown deployment mode; no cloud changes attempted.' }
$changed = @($changes.Keys | Sort-Object | Where-Object { -not $original.ContainsKey($_) -or $original[$_] -cne $changes[$_] })
$summary = [ordered]@{
    ok=$true; applied=$false; environment=$envId; function=$functionName; mode=$original.LIGHT_MODE
    previous=@{singleFen=$original['LIGHT_PRICE_SINGLE_FEN'];monthFen=$original['LIGHT_PRICE_MONTH_FEN']}
    prices=@{singleFen=[int]$SingleFen;monthFen=[int]$MonthFen}; changedKeys=$changed
}
if (-not $Apply) { $summary | ConvertTo-Json -Depth 4; return }
if ($changed.Count) {
    $merged = $original.Clone()
    foreach ($name in $changes.Keys) { $merged[$name] = $changes[$name] }
    $variables = @($merged.GetEnumerator() | ForEach-Object { @{Key=$_.Key;Value=$_.Value} })
    $body = @{FunctionName=$functionName;Namespace=$envId;Environment=@{Variables=$variables}} | ConvertTo-Json -Compress -Depth 8
    $null = Invoke-TcbJson -CliArgs @('api', 'scf', 'UpdateFunctionConfiguration', '--api-version', '2018-04-16', '--body', $body, '-r', 'ap-shanghai')
}
$after = Wait-Ready
$actual = Read-Variables $after
$mergedKeys = @($original.Keys) + @($changes.Keys) | Sort-Object -Unique
foreach ($name in $mergedKeys) {
    $expected = if ($changes.ContainsKey($name)) { $changes[$name] } else { $original[$name] }
    if (-not $actual.ContainsKey($name) -or $actual[$name] -cne $expected) { throw "Configuration readback mismatch: $name." }
}
foreach ($field in @('Runtime', 'Role', 'Timeout', 'MemorySize')) {
    if ($before.$field -cne $after.$field) { throw "Function configuration changed unexpectedly: $field." }
}
if (($before.Triggers | ConvertTo-Json -Compress -Depth 10) -cne ($after.Triggers | ConvertTo-Json -Compress -Depth 10)) { throw 'Trigger configuration changed unexpectedly.' }
$summary.applied = $true
$summary.existingConfigurationPreserved = $true
$summary | ConvertTo-Json -Depth 4
