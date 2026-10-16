# Genspark edition: build the Windows installer (.exe) with one command.
# Usage (PowerShell, inside the repository folder):
#   powershell -ExecutionPolicy Bypass -File scripts\genspark\build-windows.ps1
# Output: apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\*.exe
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

Write-Host '[1/4] Checking Node.js and pnpm...' -ForegroundColor Cyan
node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js is not installed. Install Node.js 24 first.' }
corepack enable
corepack prepare pnpm@11.28.5 --activate
pnpm --version

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vc = if (Test-Path $vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { '' }
if (-not $vc) { throw 'Visual Studio Build Tools (Desktop development with C++) is not installed. See INSTALL_JA.md step 3.' }
git config --global core.longpaths true

Write-Host '[2/4] Installing dependencies (this takes a while)...' -ForegroundColor Cyan
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }

Write-Host '[3/4] Writing package settings...' -ForegroundColor Cyan
$settings = @(
  'DSH_DESKTOP_APP_ID=com.deepseek.harness'
  'DSH_DESKTOP_AUTO_UPDATE_ENV=production'
  'DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://www.genspark.ai'
)
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) 'apps\desktop\.env.windows'), $settings)

Write-Host '[4/4] Building the installer (30-90 minutes)...' -ForegroundColor Cyan
$version = '0.2.1-alpha.2.genspark.' + (Get-Date -Format 'yyyyMMddHHmm')
pnpm run package:desktop:win:x64:unsigned --build-version $version
if ($LASTEXITCODE -ne 0) { throw 'Build failed. See apps\desktop\.desktop-build\packaging-runs for logs.' }

$exe = Get-ChildItem 'apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\*.exe' | Sort-Object LastWriteTime | Select-Object -Last 1
Write-Host ''
Write-Host "Done! Installer: $($exe.FullName)" -ForegroundColor Green
explorer.exe /select,"$($exe.FullName)"
