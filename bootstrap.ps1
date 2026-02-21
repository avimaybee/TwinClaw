# TwinClaw Bootstrap Script (Windows)

Write-Host "Eagle-eyed agentic AI gateway with multi-modal hooks and proactive memory." -ForegroundColor Blue
Write-Host "Initializing TwinClaw..." -ForegroundColor Cyan

# 1. Check for Node.js
try {
    $nodeVersion = node -v
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "X Node.js not found. Please install Node.js v22+ from https://nodejs.org" -ForegroundColor Red
    exit
}

# 2. Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

# 3. Configure git hooks for local type-check guardrail
if (Test-Path .git) {
    try {
        npm run setup:hooks | Out-Null
        Write-Host "✓ Git pre-commit hook path configured (.githooks)." -ForegroundColor Green
    } catch {
        Write-Host "! Unable to configure git hook path automatically." -ForegroundColor Yellow
    }
}

# 4. Start the agent (which will auto-trigger setup if needed)
Write-Host "Starting TwinClaw..." -ForegroundColor Cyan
npm start
