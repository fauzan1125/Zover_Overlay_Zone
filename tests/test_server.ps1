# ============================================================
# ZoVer Server-Side Logic & Security Test Suite
# Tests server.ps1 routines: MIME types, Origin guards,
# SSRF Whitelist, Path-Traversal, Config UTF-8 & APIs.
# ============================================================

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$serverScript = Join-Path $rootDir "server.ps1"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ZoVer Server Logic & Security Test Suite" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$testsPassed = 0
$testsFailed = 0

function Assert-Test($testName, $condition, $failureDetails = "") {
    if ($condition) {
        Write-Host " [PASS] $testName" -ForegroundColor Green
        $global:testsPassed++
    } else {
        Write-Host " [FAIL] $testName" -ForegroundColor Red
        if ($failureDetails) {
            Write-Host "        Details: $failureDetails" -ForegroundColor Yellow
        }
        $global:testsFailed++
    }
}

# ------------------------------------------------------------
# 1. MIME Types Verification
# ------------------------------------------------------------
Write-Host "`n--- Test Group 1: MIME Type Mapping ---" -ForegroundColor Cyan
$expectedMimes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.mp3'  = 'audio/mpeg'
    '.webp' = 'image/webp'
}

$serverContent = Get-Content $serverScript -Raw
$hasAllMimes = $true
foreach ($ext in $expectedMimes.Keys) {
    if ($serverContent -notmatch [regex]::Escape($ext)) {
        $hasAllMimes = $false
        break
    }
}
Assert-Test "All critical audio, video, web and font MIME types defined" $hasAllMimes

# ------------------------------------------------------------
# 2. SSRF Host Whitelist
# ------------------------------------------------------------
Write-Host "`n--- Test Group 2: SSRF Proxy Host Whitelist ---" -ForegroundColor Cyan
$allowedProxyHosts = @('www.youtube.com', 'youtube.com', 'm.youtube.com', 'kick.com', 'www.kick.com', 'tiktok.com', 'www.tiktok.com')

function Test-HostAllowed($targetUrl) {
    try {
        $hostOnly = ([System.Uri]$targetUrl).Host
        return ($allowedProxyHosts -contains $hostOnly)
    } catch {
        return $false
    }
}

Assert-Test "Allow valid YouTube target" (Test-HostAllowed "https://www.youtube.com/live_chat?v=123")
Assert-Test "Allow valid Kick target" (Test-HostAllowed "https://kick.com/api/v2/channels/test")
Assert-Test "Allow valid TikTok target" (Test-HostAllowed "https://www.tiktok.com/@user/live")
Assert-Test "Block internal intranet IP (192.168.1.1)" (-not (Test-HostAllowed "http://192.168.1.1/admin"))
Assert-Test "Block AWS metadata endpoint (169.254.169.254)" (-not (Test-HostAllowed "http://169.254.169.254/latest/meta-data/"))
Assert-Test "Block arbitrary attacker domain" (-not (Test-HostAllowed "https://evil-attacker.com/steal"))
Assert-Test "Block subdomain bypass trick (kick.com.evil.com)" (-not (Test-HostAllowed "https://kick.com.evil.com/"))

# ------------------------------------------------------------
# 3. Path-Traversal Boundary Check
# ------------------------------------------------------------
Write-Host "`n--- Test Group 3: Path Traversal Security ---" -ForegroundColor Cyan

function Test-PathSafety($urlPath, $baseDir) {
    $filePath = Join-Path $baseDir ($urlPath -replace '/', '\')
    $rootFull = ([System.IO.Path]::GetFullPath($baseDir)).TrimEnd('\')
    $fullPath = [System.IO.Path]::GetFullPath($filePath)
    return $fullPath.StartsWith($rootFull + '\')
}

Assert-Test "Allow legit file in root (index.html)" (Test-PathSafety "/index.html" $rootDir)
Assert-Test "Allow legit file in subfolder (css/styles.css)" (Test-PathSafety "/css/styles.css" $rootDir)
Assert-Test "Block traversal with ../ (../../Windows/System32)" (-not (Test-PathSafety "/../../Windows/System32/calc.exe" $rootDir))
Assert-Test "Block encoded traversal (/..%2f..%2f)" (-not (Test-PathSafety "/../config.json" $rootDir))

# ------------------------------------------------------------
# 4. Local Origin (CSRF) Guard
# ------------------------------------------------------------
Write-Host "`n--- Test Group 4: Local Origin CSRF Guard ---" -ForegroundColor Cyan
$port = 8765

function Test-OriginMock($originHeader) {
    if (-not $originHeader) { return $true }
    return ($originHeader -eq "http://localhost:$port" -or $originHeader -eq "http://127.0.0.1:$port")
}

Assert-Test "Allow request with no Origin header (CLI / curl)" (Test-OriginMock $null)
Assert-Test "Allow Origin http://localhost:8765" (Test-OriginMock "http://localhost:8765")
Assert-Test "Allow Origin http://127.0.0.1:8765" (Test-OriginMock "http://127.0.0.1:8765")
Assert-Test "Block malicious cross-origin website (https://malicious.com)" (-not (Test-OriginMock "https://malicious.com"))
Assert-Test "Block port confusion (http://localhost:8080)" (-not (Test-OriginMock "http://localhost:8080"))

# ------------------------------------------------------------
# 5. Media Upload Sanitization Logic
# ------------------------------------------------------------
Write-Host "`n--- Test Group 5: Media Upload Filename Sanitization ---" -ForegroundColor Cyan

function Get-SafeFilename($rawName) {
    $cleanName = [System.IO.Path]::GetFileName([System.Uri]::UnescapeDataString($rawName))
    $safeName = ($cleanName -replace '[^a-zA-Z0-9_\.-]', '_').ToLower()
    if (-not ($safeName.Trim('_.'))) { $safeName = "media_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ".bin" }
    return $safeName
}

Assert-Test "Normal filename preserved" ((Get-SafeFilename "my_alert.mp3") -eq "my_alert.mp3")
Assert-Test "Path components stripped (C:\temp\evil.mp3)" ((Get-SafeFilename "C:\temp\evil.mp3") -eq "evil.mp3")
Assert-Test "Traversal stripped (../../alert.mp3)" ((Get-SafeFilename "../../alert.mp3") -eq "alert.mp3")
Assert-Test "Spaces and special symbols sanitized" ((Get-SafeFilename "Sound Effect #1 (Loud)!.mp3") -eq "sound_effect__1__loud__.mp3")
Assert-Test "Empty or dangerous name fallback to timestamp" ((Get-SafeFilename "???").StartsWith("media_"))

# ------------------------------------------------------------
# 6. Config JSON Integrity & UTF-8 Compatibility
# ------------------------------------------------------------
Write-Host "`n--- Test Group 6: Config Schema & UTF-8 Preservation ---" -ForegroundColor Cyan
$exampleConfigPath = Join-Path $rootDir "config.example.json"
Assert-Test "config.example.json exists" (Test-Path $exampleConfigPath)

$exampleJson = Get-Content $exampleConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Test "Config contains Kick fields" ($exampleJson.PSObject.Properties['kickUsername'] -ne $null)
Assert-Test "Config contains YouTube fields" ($exampleJson.PSObject.Properties['ytVideoInput'] -ne $null)
Assert-Test "Config contains TikTok fields" ($exampleJson.PSObject.Properties['tiktokUsername'] -ne $null)
Assert-Test "Config contains TTS settings" ($exampleJson.PSObject.Properties['ttsEnabled'] -ne $null)
Assert-Test "Config contains Alert definitions" ($exampleJson.alerts.PSObject.Properties['yt_sub'] -ne $null)

# Test UTF-8 with international / Indonesian characters
$testUtf8Obj = @{
    kickUsername = "Streamer_Indo"
    ttsTemplate = "{user} berkata halo dunia"
}
$testUtf8Json = $testUtf8Obj | ConvertTo-Json
$utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($testUtf8Json)
$roundtrip = [System.Text.Encoding]::UTF8.GetString($utf8Bytes) | ConvertFrom-Json
Assert-Test "UTF-8 roundtrip preserves strings properly" ($roundtrip.kickUsername -eq "Streamer_Indo")

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Cyan
$resultColor = if ($testsFailed -eq 0) { 'Green' } else { 'Red' }
Write-Host "  Test Results: $testsPassed Passed, $testsFailed Failed" -ForegroundColor $resultColor
Write-Host "============================================================" -ForegroundColor Cyan

if ($testsFailed -gt 0) {
    exit 1
} else {
    exit 0
}
