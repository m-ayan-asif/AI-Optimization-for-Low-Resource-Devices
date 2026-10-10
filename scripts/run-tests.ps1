#Requires -Version 5.1
# Runs every test suite in the repo (server/Jest, client/Vitest, inference/pytest,
# dashboard/pytest) and prints a pass/fail summary at the end.

$root       = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) { $venvPython = 'python' }

$results = @()

function Run-Suite($name, $workDir, $exe, $exeArgs) {
    Write-Host "`n===================================================" -ForegroundColor Cyan
    Write-Host " $name" -ForegroundColor Cyan
    Write-Host "===================================================" -ForegroundColor Cyan
    Push-Location $workDir
    & $exe @exeArgs
    $code = $LASTEXITCODE
    Pop-Location
    $script:results += [PSCustomObject]@{ Suite = $name; Passed = ($code -eq 0) }
}

Run-Suite "Server (Jest)"      (Join-Path $root 'server')    'npm'        @('test')
Run-Suite "Client (Vitest)"    (Join-Path $root 'client')    'npm'        @('test')
Run-Suite "Inference (pytest)" (Join-Path $root 'inference') $venvPython  @('-m', 'pytest', 'tests', '-v')
Run-Suite "Dashboard (pytest)" (Join-Path $root 'dashboard')  $venvPython @('-m', 'pytest', 'tests', '-v')

Write-Host "`n`n===================================================" -ForegroundColor Yellow
Write-Host " TEST SUMMARY" -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Yellow
foreach ($r in $results) {
    $color  = if ($r.Passed) { 'Green' } else { 'Red' }
    $status = if ($r.Passed) { 'PASS' } else { 'FAIL' }
    Write-Host ("{0,-22} {1}" -f $r.Suite, $status) -ForegroundColor $color
}

$failed = $results | Where-Object { -not $_.Passed }
if ($failed) {
    Write-Host "`n$($failed.Count) of $($results.Count) suite(s) failed." -ForegroundColor Red
} else {
    Write-Host "`nAll $($results.Count) suites passed." -ForegroundColor Green
}

Read-Host "`nPress Enter to close"
exit $(if ($failed) { 1 } else { 0 })
