#Requires -Version 5.1
# Sets up (installs what's missing, bootstraps the database) and launches all four
# SkinSense services, each in its own visible window: inference, server, client, dashboard.

$ErrorActionPreference = 'Stop'
$root        = Split-Path -Parent $PSScriptRoot
$serverDir   = Join-Path $root 'server'
$clientDir   = Join-Path $root 'client'
$inferenceDir = Join-Path $root 'inference'
$dashboardDir = Join-Path $root 'dashboard'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Info($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Warn($msg) { Write-Host "    WARNING: $msg" -ForegroundColor Yellow }

Write-Host "===================================================" -ForegroundColor Magenta
Write-Host " SkinSense - Setup and Launch" -ForegroundColor Magenta
Write-Host "===================================================" -ForegroundColor Magenta

# ── 1. Prerequisites ─────────────────────────────────────────────────────
Step "Checking prerequisites"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm  = Get-Command npm  -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Write-Host "Node.js/npm not found on PATH. Install Node.js 20.19+ and re-run." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}
Info "node $(& node -v), npm $(& npm -v)"

$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    Info "No .venv found at repo root - creating one..."
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pyCmd) { $pyCmd = Get-Command py -ErrorAction SilentlyContinue }
    if (-not $pyCmd) {
        Write-Host "Python not found on PATH. Install Python 3.10+ and re-run." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
    & $pyCmd.Source -m venv (Join-Path $root '.venv')
}
Info "Using Python venv: $venvPython"

# ── 2. Python dependencies (inference + dashboard) ──────────────────────
Step "Installing/verifying Python dependencies"
& $venvPython -m pip install -q -r (Join-Path $inferenceDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Warn "inference/requirements.txt install reported errors (see above)" }
& $venvPython -m pip install -q -r (Join-Path $dashboardDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Warn "dashboard/requirements.txt install reported errors (see above)" }

# ── 3. Node dependencies (server + client) ───────────────────────────────
Step "Installing/verifying Node dependencies"
foreach ($pair in @(@{Name='server'; Dir=$serverDir}, @{Name='client'; Dir=$clientDir})) {
    $nodeModules = Join-Path $pair.Dir 'node_modules'
    if (Test-Path $nodeModules) {
        Info "$($pair.Name): node_modules already present, skipping npm install"
    } else {
        Info "$($pair.Name): installing..."
        Push-Location $pair.Dir
        & npm install
        Pop-Location
    }
}

# ── 4. server/.env ────────────────────────────────────────────────────────
Step "Checking server/.env"
$envPath = Join-Path $serverDir '.env'
$envExamplePath = Join-Path $serverDir '.env.example'
if (-not (Test-Path $envPath)) {
    Warn "server/.env missing - copying from .env.example. Edit DB_PASSWORD and JWT_SECRET before relying on this."
    Copy-Item $envExamplePath $envPath
}

function Get-EnvValue($path, $key, $default) {
    if (-not (Test-Path $path)) { return $default }
    $line = Get-Content $path | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
    if (-not $line) { return $default }
    return ($line -split '=', 2)[1].Trim()
}

# ── 5. Database bootstrap (best-effort, never blocks the launch) ─────────
Step "Checking database"
$dbHost     = Get-EnvValue $envPath 'DB_HOST' 'localhost'
$dbPort     = Get-EnvValue $envPath 'DB_PORT' '5432'
$dbName     = Get-EnvValue $envPath 'DB_NAME' 'skinsense'
$dbUser     = Get-EnvValue $envPath 'DB_USER' 'postgres'
$dbPassword = Get-EnvValue $envPath 'DB_PASSWORD' ''

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    Warn "psql not found on PATH - skipping automatic database setup."
    Warn "Run the migrations manually: see documentation/SETUP_INSTRUCTIONS.md, step 2."
} else {
    $env:PGPASSWORD = $dbPassword
    $exists = & psql -h $dbHost -p $dbPort -U $dbUser -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
    if ($LASTEXITCODE -ne 0) {
        Warn "Could not reach PostgreSQL at ${dbHost}:${dbPort} as $dbUser - skipping automatic database setup."
    } elseif ($exists -match '1') {
        Info "Database '$dbName' already exists - skipping migrations."
    } else {
        Info "Creating database '$dbName' and applying migrations..."
        & psql -h $dbHost -p $dbPort -U $dbUser -c "CREATE DATABASE $dbName;"
        $migrations = Get-ChildItem (Join-Path $serverDir 'migrations') -Filter '*.sql' | Sort-Object Name
        foreach ($m in $migrations) {
            Info "  applying $($m.Name)"
            & psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -f $m.FullName
        }
    }
}

# ── 6. Launch the four services, each in its own window ─────────────────
Step "Launching services"

# A previous run's window can leave its node/python process behind (closing a console window doesn't always
# kill the grandchild process npm/uvicorn spawned underneath it). A leftover process squatting on a service's
# port makes Vite/uvicorn silently jump to the next free port instead - which looks like "it didn't launch".
# Free the exact port each service expects before starting it.
function Clear-Port($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Info "Port $port was held by a leftover $($proc.ProcessName) process (PID $($proc.Id)) - stopping it"
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

foreach ($port in 5001, 5000, 5173, 8501) { Clear-Port $port }
Start-Sleep -Seconds 1

function Start-ServiceWindow($title, $workDir, $command) {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$workDir'; $command"
    ) | Out-Null
    Info "started: $title"
}

Start-ServiceWindow "SkinSense - Inference (5001)" $inferenceDir "& '$venvPython' server.py"
Start-Sleep -Seconds 2
Start-ServiceWindow "SkinSense - Server (5000)"    $serverDir    "npm run dev"
Start-Sleep -Seconds 2
Start-ServiceWindow "SkinSense - Client (5173)"    $clientDir    "npm run dev"
Start-Sleep -Seconds 2
Start-ServiceWindow "SkinSense - Dashboard (8501)" $dashboardDir "& '$venvPython' -m streamlit run app.py"

Write-Host "`n===================================================" -ForegroundColor Green
Write-Host " All services launched in separate windows:" -ForegroundColor Green
Write-Host "   Inference : http://localhost:5001/health"
Write-Host "   Server    : http://localhost:5000/api/health"
Write-Host "   Client    : http://localhost:5173"
Write-Host "   Dashboard : http://localhost:8501"
Write-Host "===================================================" -ForegroundColor Green
Write-Host "Close each service's own window to stop it."

Read-Host "`nPress Enter to close this setup window (services keep running)"
