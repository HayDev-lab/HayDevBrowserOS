param(
    [string]$CredentialFile,
    [string]$TargetDirectory
)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
if ($CredentialFile) {
    # Read only the requested Gemini setting. Never echo or copy credentials.
    $raw = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CredentialFile))
    $match = [regex]::Match($raw, '(?m)^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*)$')
    if (!$match.Success) { throw 'GEMINI_API_KEY is absent in the selected environment file' }
    $secret = $match.Groups[1].Value.Trim().Trim([char]34).Trim([char]39)
    if ($secret.Length -lt 20 -or $secret -match '\s') { throw 'Invalid Gemini key format' }
    $env:GEMINI_API_KEY = $secret
    $secret = $null; $raw = $null; $match = $null
}
if ($TargetDirectory) { $env:CARGO_TARGET_DIR = $TargetDirectory }
$env:CARGO_BUILD_JOBS = '6'
if (!$env:GEMINI_LIVE_MODEL) { $env:GEMINI_LIVE_MODEL = 'gemini-3.8-live' }
Push-Location $project
try { & npm.cmd run dev:tauri; exit $LASTEXITCODE }
finally { Pop-Location; Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue }
