# Builds the Paylog Android APK.
#
# React Native's native build breaks on long Windows paths, and building inside
# OneDrive would sync gigabytes of build files, so the source is mirrored to a
# short local folder (C:\pl\mobile) and built there.
#
# Usage (PowerShell, from the mobile folder):
#   .\scripts\build-android.ps1                  # phone APK, talks to the live server
#   .\scripts\build-android.ps1 -Emulator        # emulator APK, talks to the backend on this PC
param(
    [switch]$Emulator,
    [string]$ApiUrl = "",
    [string]$BuildDir = "C:\pl\mobile"
)
# Native tools print warnings on stderr; failures are caught through their exit codes below.
$ErrorActionPreference = "Continue"

$source = Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_ENV = "production"

if ($Emulator) {
    $env:PAYLOG_ALLOW_HTTP = "1"
    $env:EXPO_PUBLIC_API_URL = if ($ApiUrl) { $ApiUrl } else { "http://10.0.2.2:5001" }
    $abis = "x86_64"
} else {
    Remove-Item Env:PAYLOG_ALLOW_HTTP -ErrorAction SilentlyContinue
    if ($ApiUrl) { $env:EXPO_PUBLIC_API_URL = $ApiUrl } else { Remove-Item Env:EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue }
    $abis = "arm64-v8a,armeabi-v7a"
}

Write-Host "1/4 Copying source to $BuildDir"
robocopy $source $BuildDir /MIR /XD node_modules android ios .expo .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

Set-Location $BuildDir
Write-Host "2/4 Installing packages"
npm ci --no-audit --no-fund
if ($LASTEXITCODE) { throw "npm ci failed" }

Write-Host "3/4 Generating the native Android project"
npx expo prebuild --platform android --clean --no-install
if ($LASTEXITCODE) { throw "prebuild failed" }

Write-Host "4/4 Building ($abis)"
Set-Location android
.\gradlew.bat assembleRelease "-PreactNativeArchitectures=$abis"
if ($LASTEXITCODE) { throw "gradle build failed" }

$apk = Join-Path $BuildDir "android\app\build\outputs\apk\release\app-release.apk"
$name = if ($Emulator) { "paylog-emulator.apk" } else { "paylog.apk" }
$out = Join-Path $source "dist\$name"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
Copy-Item $apk $out -Force
Write-Host "Done: $out"
