# CampusCore Load Testing Scripts
# Run from project root: .\load-tests\scripts\run-tests.ps1

param(
    [Parameter(Position=0)]
    [ValidateSet("smoke", "load", "stress", "spike", "soak", "all")]
    [string]$TestType = "smoke"
)

$ErrorActionPreference = "Stop"

# Colors (for PowerShell)
function Write-Green { param($m) Write-Host $m -ForegroundColor Green }
function Write-Yellow { param($m) Write-Host $m -ForegroundColor Yellow }
function Write-Red { param($m) Write-Host $m -ForegroundColor Red }

# Default values
$BASE_URL = if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost" }
$API_BASE_URL = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { "http://localhost/api/v1" }

Write-Green "=== CampusCore Load Testing ==="
Write-Host "Base URL: $BASE_URL"
Write-Host "API URL: $API_BASE_URL"
Write-Host ""

# Check if k6 is installed
$k6Path = Get-Command k6 -ErrorAction SilentlyContinue
if (-not $k6Path) {
    Write-Red "k6 is not installed. Please install from: https://k6.io/docs/getting-started/installation/"
    exit 1
}

# Create reports directory if not exists
$reportsDir = "load-tests\reports"
if (-not (Test-Path $reportsDir)) {
    New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
}

# Helper function to run k6
function Run-K6Test {
    param(
        [string]$Name,
        [string]$Duration,
        [int]$VUs,
        [string]$Scenario
    )
    
    Write-Yellow "Running $Name..."
    
    $outputFile = "$reportsDir\$($TestType.ToLower())-results.json"
    
    k6 run "load-tests\src\main.js" `
        --out "json=$outputFile" `
        --duration $Duration `
        --vus $VUs `
        -e "BASE_URL=$BASE_URL" `
        -e "API_BASE_URL=$API_BASE_URL" `
        -e "SCENARIO=$Scenario"
}

# Run tests based on type
switch ($TestType) {
    "smoke" {
        Run-K6Test -Name "Smoke Test" -Duration "30s" -VUs 1 -Scenario "smoke"
    }
    "load" {
        Run-K6Test -Name "Load Test" -Duration "2m" -VUs 10 -Scenario "load"
    }
    "stress" {
        Run-K6Test -Name "Stress Test" -Duration "4m" -VUs 50 -Scenario "stress"
    }
    "spike" {
        Run-K6Test -Name "Spike Test" -Duration "1m" -VUs 50 -Scenario "spike"
    }
    "soak" {
        Run-K6Test -Name "Soak Test" -Duration "5m" -VUs 10 -Scenario "soak"
    }
    "all" {
        Run-K6Test -Name "Smoke Test" -Duration "30s" -VUs 1 -Scenario "smoke"
        Run-K6Test -Name "Load Test" -Duration "2m" -VUs 10 -Scenario "load"
    }
}

Write-Green "=== Tests Complete ==="
