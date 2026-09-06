<#
.SYNOPSIS
  Starts the Collex Inquiries stack locally: client, API and queue worker.

.DESCRIPTION
  A convenience wrapper around `npm run start:local`. It adds three things the
  bare npm script cannot do on Windows:

    1. Stops leftover processes FROM THIS PROJECT ONLY, so a previous run does
       not hold port 5100 or the Prisma query-engine DLL.
    2. Checks PostgreSQL is reachable before starting, because an API that dies
       four seconds after a successful-looking launch is the most confusing way
       to discover the database is down.
    3. Prints where everything is listening.

  `npm run start:local` does the same work and is cross-platform. Use that if
  you prefer; this only exists because killing stale processes precisely is
  awkward in a shell-agnostic npm script.

.EXAMPLE
  .\start-local.ps1
  .\start-local.ps1 -SkipBuild      # skip the one-off build (faster restart)
#>

[CmdletBinding()]
param(
  [switch]$SkipBuild
)

# NOT 'Stop'.
#
# Under PowerShell 5.1, 'Stop' turns anything a native executable writes to
# stderr into a TERMINATING error — even on exit code 0. Prisma writes
# "Environment variables loaded from .env" to stderr as ordinary information,
# so 'Stop' aborts this script on a successful build. Correctness here comes
# from checking $LASTEXITCODE explicitly after each external command, which is
# the only reliable signal a native program gives.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot

function Write-Step { param($n, $text) Write-Host "  [$n] $text" -ForegroundColor Yellow }
function Write-Ok   { param($text)     Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn { param($text)     Write-Host "  [!]  $text" -ForegroundColor DarkYellow }
function Write-Err  { param($text)     Write-Host "  [X]  $text" -ForegroundColor Red }

Write-Host ""
Write-Host "  ====================================================" -ForegroundColor Cyan
Write-Host "  |      Collex Inquiries - Local Dev Launcher       |" -ForegroundColor Cyan
Write-Host "  ====================================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Stop leftovers from THIS project ────────────────────────────────────
#
# Matched on the project's own path, never on words like "server", "dist" or
# "nest". Those substrings appear in the command line of unrelated Node
# processes — including the sibling Collex System V1 project, whose path is
# "...\Collex System V1\server\...", and including the editor's own tooling.
# A launcher that kills someone else's dev server to start its own is worse
# than one that leaves a stale port behind.
Write-Step '1/4' 'Stopping leftover processes from this project ...'

# Matching the path alone is not enough. The worker runs as
# `node --watch dist/worker.js` — a RELATIVE path, so this project's directory
# never appears in its command line, and a leftover worker would survive the
# restart still holding a database connection.
#
# So: find the processes that do name this directory, then take everything
# descended from them. Ownership is established by the process tree, which is
# exact, instead of by a substring, which is a guess.
$allNode = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
$byParent = @{}
foreach ($proc in $allNode) {
  if (-not $byParent.ContainsKey($proc.ParentProcessId)) {
    $byParent[$proc.ParentProcessId] = New-Object System.Collections.ArrayList
  }
  [void]$byParent[$proc.ParentProcessId].Add($proc)
}

$owned = New-Object System.Collections.Generic.HashSet[int]
$queue = New-Object System.Collections.Generic.Queue[int]

foreach ($proc in $allNode) {
  if ($proc.CommandLine -and $proc.CommandLine.Contains($root)) {
    if ($owned.Add([int]$proc.ProcessId)) { $queue.Enqueue([int]$proc.ProcessId) }
  }
}
while ($queue.Count -gt 0) {
  $parent = $queue.Dequeue()
  if ($byParent.ContainsKey($parent)) {
    foreach ($child in $byParent[$parent]) {
      if ($owned.Add([int]$child.ProcessId)) { $queue.Enqueue([int]$child.ProcessId) }
    }
  }
}

$stopped = 0
foreach ($pidToStop in $owned) {
  # Never stop the shell running this script, nor its ancestors.
  if ($pidToStop -eq $PID) { continue }
  try {
    Stop-Process -Id $pidToStop -Force -ErrorAction Stop
    $stopped++
  } catch { }
}

if ($stopped -gt 0) {
  Write-Ok "stopped $stopped process(es)"
  # Windows releases the Prisma query-engine DLL lazily; without this pause the
  # rebuild below fails with EPERM on a rename.
  Start-Sleep -Seconds 2
} else {
  Write-Host "  nothing to stop" -ForegroundColor DarkGray
}

# ── 2. Is the database up? ─────────────────────────────────────────────────
Write-Step '2/4' 'Checking PostgreSQL ...'

$envFile = Join-Path $root 'server\.env'
if (-not (Test-Path $envFile)) { $envFile = Join-Path $root '.env' }

$dbHost = 'localhost'
$dbPort = 5432
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if ($line -and $line.Line -match '@([^:/@]+):(\d+)/') {
    $dbHost = $Matches[1]
    $dbPort = [int]$Matches[2]
  }
}

$dbUp = $false
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $dbUp = $client.ConnectAsync($dbHost, $dbPort).Wait(2000)
  $client.Close()
} catch { $dbUp = $false }

if ($dbUp) {
  Write-Ok "PostgreSQL is reachable at ${dbHost}:${dbPort}"
} else {
  Write-Err "PostgreSQL is NOT reachable at ${dbHost}:${dbPort}"
  Write-Host ""
  Write-Host "  The API will start and then fail its readiness check." -ForegroundColor DarkGray
  Write-Host "  Start it with one of:" -ForegroundColor DarkGray
  Write-Host "    docker compose up -d postgres redis" -ForegroundColor Gray
  Write-Host "    (or see docs/local-database.md for a Docker-free cluster)" -ForegroundColor Gray
  Write-Host ""
  $answer = Read-Host "  Start anyway? [y/N]"
  if ($answer -notmatch '^[Yy]') { exit 1 }
}

# Redis is optional by design: without it the queue runs jobs inline and
# /readiness says so. Worth a warning, never worth blocking on.
$redisUp = $false
try {
  $client = New-Object System.Net.Sockets.TcpClient
  $redisUp = $client.ConnectAsync('localhost', 6381).Wait(1000)
  $client.Close()
} catch { $redisUp = $false }

if (-not $redisUp) {
  Write-Warn 'Redis is not reachable - jobs will run inline (reports will be slower)'
}

# ── 3. Build once ──────────────────────────────────────────────────────────
#
# The worker runs `node --watch dist/worker.js`, so dist/worker.js has to exist
# before the three processes start. `nest start --watch` (the API) is the single
# compiler from then on and re-emits it on every change.
if ($SkipBuild) {
  Write-Step '3/4' 'Skipping build (-SkipBuild)'
  if (-not (Test-Path (Join-Path $root 'server\dist\worker.js'))) {
    Write-Err 'server\dist\worker.js is missing - run without -SkipBuild once'
    exit 1
  }
} else {
  Write-Step '3/4' 'Building the server (clean + prisma generate + nest build) ...'
  Push-Location (Join-Path $root 'server')
  npm run build
  $buildExit = $LASTEXITCODE
  Pop-Location
  if ($buildExit -ne 0) {
    Write-Err "Server build failed (exit $buildExit)"
    exit 1
  }
  Write-Ok 'build succeeded'
}

# ── 4. Go ──────────────────────────────────────────────────────────────────
Write-Step '4/4' 'Starting client, API and worker ...'
Write-Host ""
Write-Host "  ----------------------------------------------------" -ForegroundColor DarkCyan
Write-Host "  |  Client (Vite)  ->  http://localhost:5174        |" -ForegroundColor DarkCyan
Write-Host "  |  API    (Nest)  ->  http://localhost:5100        |" -ForegroundColor DarkCyan
Write-Host "  |  Swagger        ->  http://localhost:5100/api/docs |" -ForegroundColor DarkCyan
Write-Host "  |  Worker         ->  background queue processor   |" -ForegroundColor DarkCyan
Write-Host "  ----------------------------------------------------" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Ctrl+C stops all three." -ForegroundColor DarkGray
Write-Host ""

Push-Location $root
# Not `npm run start:local` — that would build a second time. The three
# processes are launched directly against the build just made above.
npx concurrently -n client,api,worker -c cyan,green,magenta `
  "npm run client" "npm run server" "npm run worker"
Pop-Location
