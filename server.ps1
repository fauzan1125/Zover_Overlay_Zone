# ============================================================
# Local HTTP Server & YouTube CORS Proxy (with Cookie Consent & POST Support)
# Jalankan script ini, lalu buka http://localhost:8765
# ============================================================

$port = 8765
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Multi-Chat Overlay Local Server" -ForegroundColor Yellow
Write-Host "  http://localhost:$port" -ForegroundColor Green  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Root Dir: $rootDir" -ForegroundColor Gray
Write-Host "Tekan Ctrl+C untuk menghentikan server." -ForegroundColor Gray
Write-Host ""

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${port}/")
$listener.Prefixes.Add("http://127.0.0.1:${port}/")

try {
    $listener.Start()
    Write-Host "[SERVER] Listening on http://localhost:$port ..." -ForegroundColor Green
} catch {
    # Probe verify whether occupying process is an active ZoVer instance
    $isZoVerActive = $false
    try {
        $probeReq = [System.Net.WebRequest]::Create("http://localhost:${port}/api/events?since=0")
        $probeReq.Timeout = 2000
        $probeRes = $probeReq.GetResponse()
        $probeStream = $probeRes.GetResponseStream()
        $probeReader = New-Object System.IO.StreamReader($probeStream)
        $probeBody = $probeReader.ReadToEnd()
        $probeReader.Close()
        $probeRes.Close()
        $parsedEvents = ConvertFrom-Json $probeBody -ErrorAction Stop
        if ($parsedEvents -is [System.Array]) {
            $isZoVerActive = $true
        }
    } catch {}

    Write-Host ""
    if ($isZoVerActive) {
        Write-Host "[INFO] Server Multi-Chat Overlay SUDAH BERJALAN di latar belakang / jendela lain!" -ForegroundColor Yellow
        Write-Host "Port $port sudah aktif melayani http://localhost:$port" -ForegroundColor Cyan
        Write-Host "Anda tidak perlu membuka jendela server ganda. Cukup buka browser di: http://localhost:$port" -ForegroundColor Green
        Write-Host ""
        Write-Host "Jika ingin merestart server, tutup semua jendela server lalu jalankan kembali." -ForegroundColor Gray
    } else {
        Write-Host "[PERINGATAN] Port $port sedang digunakan oleh aplikasi lain!" -ForegroundColor Red
        Write-Host "Layanan di port $port bukan server ZoVer aktif." -ForegroundColor Yellow
        Write-Host "Hentikan aplikasi yang memakai port $port atau jalankan STOP_SERVER.bat sebelum memulai ulang." -ForegroundColor Gray
    }
    Read-Host "Tekan Enter untuk menutup jendela ini..."
    exit
}

# MIME type mapping
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
    '.mp3'  = 'audio/mpeg'
    '.wav'  = 'audio/wav'
    '.ogg'  = 'audio/ogg'
    '.webp' = 'image/webp'
}

# Persistent cookie container for YouTube consent bypass
$global:cookieContainer = New-Object System.Net.CookieContainer
$global:cookieContainer.Add((New-Object System.Net.Cookie("CONSENT", "PENDING+999", "/", ".youtube.com")))
$global:cookieContainer.Add((New-Object System.Net.Cookie("SOCS", "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY", "/", ".youtube.com")))

# Global event queue for cross-process OBS Browser Source & Dashboard sync
$global:eventQueue = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))

# Tolak request lintas-origin (CSRF) kecuali dari server localhost ini sendiri.
# Request non-browser (curl) tanpa header Origin tetap diizinkan.
function Test-LocalOrigin($req) {
    $origin = $req.Headers["Origin"]
    if (-not $origin) { return $true }
    return ($origin -eq "http://localhost:$port" -or $origin -eq "http://127.0.0.1:$port")
}

# Hanya izinkan proxy ke host platform yang didukung (cegah SSRF / open-proxy)
$allowedProxyHosts = @('www.youtube.com', 'youtube.com', 'm.youtube.com', 'kick.com', 'www.kick.com', 'tiktok.com', 'www.tiktok.com')

# Allowed media upload extensions to prevent malicious script uploads
$allowedUploadExts = @('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.mp4', '.webm', '.mov', '.gif', '.png', '.jpg', '.jpeg', '.webp', '.bin')

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        # Reject unexpected host headers to protect against DNS rebinding attacks.
        $reqHost = if ($request.Headers["Host"]) { ($request.Headers["Host"] -replace '^\s+|\s+$', '').ToLower() } else { '' }
        $allowedHosts = @("localhost:$port", "127.0.0.1:$port", "localhost", "127.0.0.1")
        if (-not ($allowedHosts -contains $reqHost)) {
            $response.StatusCode = 400
            $badHostBytes = [System.Text.Encoding]::UTF8.GetBytes("Invalid Host header")
            $response.ContentLength64 = $badHostBytes.Length
            $response.OutputStream.Write($badHostBytes, 0, $badHostBytes.Length)
            $response.OutputStream.Flush()
            $response.Close()
            continue
        }

        # Aplikasi same-origin: tidak perlu CORS lintas-origin.
        # Header CORS '*' dihapus agar situs web lain tidak bisa memanggil endpoint ini.
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $urlPath = $request.Url.LocalPath

        # ============================================================
        # API: CONFIG STORAGE
        # ============================================================
        if ($urlPath -eq "/api/config") {
            $configFile = Join-Path $rootDir "config.json"
            $response.ContentType = "application/json; charset=utf-8"

            if ($request.HttpMethod -eq "GET") {
                # Fallback to template prevents empty widgets on freshly cloned setups
                $targetConfigFile = $configFile
                if (-not (Test-Path $targetConfigFile)) {
                    $fallbackConfigFile = Join-Path $rootDir "config.example.json"
                    if (Test-Path $fallbackConfigFile) {
                        $targetConfigFile = $fallbackConfigFile
                    }
                }
                if (Test-Path $targetConfigFile) {
                    $configBytes = [System.IO.File]::ReadAllBytes($targetConfigFile)
                    $response.StatusCode = 200
                    $response.ContentLength64 = $configBytes.Length
                    $response.OutputStream.Write($configBytes, 0, $configBytes.Length)
                    $response.OutputStream.Flush()
                } else {
                    $response.StatusCode = 200
                    $emptyBytes = [System.Text.Encoding]::UTF8.GetBytes("{}")
                    $response.ContentLength64 = $emptyBytes.Length
                    $response.OutputStream.Write($emptyBytes, 0, $emptyBytes.Length)
                    $response.OutputStream.Flush()
                }
            } elseif ($request.HttpMethod -eq "POST") {
                if (-not (Test-LocalOrigin $request)) {
                    $response.StatusCode = 403
                    $response.Close()
                    continue
                }
                $encoding = if ($request.ContentEncoding) { $request.ContentEncoding } else { [System.Text.Encoding]::UTF8 }
                $reader = New-Object System.IO.StreamReader($request.InputStream, $encoding)
                $postBody = $reader.ReadToEnd()
                $reader.Close()

                # Tolak body yang bukan objek JSON agar config.json tidak rusak
                try {
                    $parsedConfig = ConvertFrom-Json $postBody
                    if ($parsedConfig -isnot [System.Management.Automation.PSCustomObject]) { throw "not an object" }
                } catch {
                    $response.StatusCode = 400
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Invalid JSON config"}')
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $response.OutputStream.Flush()
                    $response.Close()
                    continue
                }

                [System.IO.File]::WriteAllText($configFile, $postBody, [System.Text.Encoding]::UTF8)
                
                $response.StatusCode = 200
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
                $response.ContentLength64 = $okBytes.Length
                $response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $response.OutputStream.Flush()
            }
            $response.Close()
            continue
        }

        # ============================================================
        # API: REAL-TIME CROSS-PROCESS EVENT BRIDGE (/api/events)
        # Allows Dashboard in Chrome and Overlays in OBS CEF to sync 100% reliably
        # ============================================================
        if ($urlPath -eq "/api/events") {
            $response.ContentType = "application/json; charset=utf-8"

            if ($request.HttpMethod -eq "GET") {
                $since = 0
                if ($request.QueryString["since"]) {
                    [long]::TryParse($request.QueryString["since"], [ref]$since) | Out-Null
                }

                $matchingEvents = [System.Collections.Generic[List[object]]]::new()
                $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                $allEvents = $global:eventQueue.ToArray()
                foreach ($evt in $allEvents) {
                    # >= agar event dengan milidetik sama persis tidak hilang;
                    # retensi 5 detik di POST lebih pendek dari window dedup client
                    if ($evt.timestamp -ge $since -and ($nowMs - $evt.timestamp) -le 5000) {
                        $matchingEvents.Add($evt) | Out-Null
                    }
                }

                # ConvertTo-Json PS 5.1 meng-unwrap array berisi 1 elemen jadi objek,
                # padahal client mengharapkan array
                if ($matchingEvents.Count -eq 0) {
                    $jsonOut = '[]'
                } else {
                    $jsonOut = '[' + (($matchingEvents | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress -Depth 5 }) -join ',') + ']'
                }
                $outBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonOut)
                $response.StatusCode = 200
                $response.ContentLength64 = $outBytes.Length
                $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
                $response.OutputStream.Flush()
            } elseif ($request.HttpMethod -eq "POST") {
                if (-not (Test-LocalOrigin $request)) {
                    $response.StatusCode = 403
                    $response.Close()
                    continue
                }

                # Limit events payload to prevent unbounded memory allocation.
                if ($request.ContentLength64 -gt 262144) {
                    $response.StatusCode = 400
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Payload too large"}')
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $response.OutputStream.Flush()
                    $response.Close()
                    continue
                }

                $encoding = if ($request.ContentEncoding) { $request.ContentEncoding } else { [System.Text.Encoding]::UTF8 }
                $reader = New-Object System.IO.StreamReader($request.InputStream, $encoding)
                $body = $reader.ReadToEnd()
                $reader.Close()

                try {
                    $evtObj = ConvertFrom-Json $body
                    if ($evtObj -isnot [System.Management.Automation.PSCustomObject]) { throw "not an object" }
                } catch {
                    $response.StatusCode = 400
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Invalid JSON payload"}')
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    $response.OutputStream.Flush()
                    $response.Close()
                    continue
                }

                if (-not $evtObj.timestamp) {
                    $evtObj | Add-Member -MemberType NoteProperty -Name "timestamp" -Value ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
                }
                [void]$global:eventQueue.Add($evtObj)

                while ($global:eventQueue.Count -gt 100) {
                    [void]$global:eventQueue.RemoveAt(0)
                }

                # buang event lebih tua dari 5 detik (sama seperti server.js)
                $evictNow = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                while ($global:eventQueue.Count -gt 0 -and ($evictNow - [long]$global:eventQueue[0].timestamp) -gt 5000) {
                    [void]$global:eventQueue.RemoveAt(0)
                }

                $response.StatusCode = 200
                $okBytes = [System.Text.Encoding]::UTF8.GetBytes('{"status":"ok"}')
                $response.ContentLength64 = $okBytes.Length
                $response.OutputStream.Write($okBytes, 0, $okBytes.Length)
                $response.OutputStream.Flush()
            }
            $response.Close()
            continue
        }

        # ============================================================
        # API: MEDIA UPLOAD (/api/upload)
        # ============================================================
        if ($urlPath -eq "/api/upload") {
            $response.ContentType = "application/json; charset=utf-8"
            if ($request.HttpMethod -ne "POST") {
                $response.StatusCode = 405
                $response.Close()
                continue
            }
            if (-not (Test-LocalOrigin $request)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            try {
                $mediaDir = Join-Path $rootDir "media\alerts"
                if (-not (Test-Path $mediaDir)) {
                    New-Item -ItemType Directory -Path $mediaDir -Force | Out-Null
                }

                $queryFilename = $request.QueryString["filename"]
                if (-not $queryFilename) {
                    $queryFilename = $request.Headers["X-Filename"]
                }

                # Only alert media may be uploaded; .html/.js rejected to block same-origin XSS
                $allowedUploadExts = @('.mp3', '.wav', '.ogg', '.m4a', '.aac', '.mp4', '.webm', '.mov', '.gif', '.png', '.jpg', '.jpeg', '.webp')

                if ($queryFilename) {
                    # Restrict upload size to 100 MB to prevent disk exhaustion attacks.
                    if ($request.ContentLength64 -gt 104857600) {
                        $response.StatusCode = 413
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Payload too large"}')
                        $response.ContentLength64 = $errBytes.Length
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                        $response.OutputStream.Flush()
                        $response.Close()
                        continue
                    }

                    # Safe unescape prevents failure when query parameters contain invalid percent encoding
                    $unescaped = try { [System.Uri]::UnescapeDataString($queryFilename) } catch { $queryFilename }
                    $cleanName = [System.IO.Path]::GetFileName($unescaped)
                    $safeName = ($cleanName -replace '[^a-zA-Z0-9_\.-]', '_').ToLower()
                    if (-not ($safeName.Trim('_.'))) { $safeName = "media_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ".bin" }

                    $uploadExt = [System.IO.Path]::GetExtension($safeName).ToLower()
                    if ($allowedUploadExts -notcontains $uploadExt) {
                        $response.StatusCode = 400
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Format file tidak diizinkan"}')
                        $response.ContentType = 'application/json'
                        $response.ContentLength64 = $errBytes.Length
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                        $response.OutputStream.Flush()
                        $response.Close()
                        continue
                    }

                    $targetFilePath = Join-Path $mediaDir $safeName
                    $fileStream = [System.IO.File]::Create($targetFilePath)
                    $request.InputStream.CopyTo($fileStream)
                    $fileStream.Flush()
                    $fileStream.Close()
                    $fileStream.Dispose()

                    $fileLen = (Get-Item $targetFilePath).Length
                    $relativeUrl = "media/alerts/" + $safeName
                    $response.StatusCode = 200
                    $resPayload = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"ok`",`"url`":`"$relativeUrl`"}")
                    $response.ContentLength64 = $resPayload.Length
                    $response.OutputStream.Write($resPayload, 0, $resPayload.Length)
                    $response.OutputStream.Flush()
                    Write-Host "[UPLOAD FAST] Saved: $relativeUrl ($fileLen bytes)" -ForegroundColor Green
                } else {
                    # 2. JSON Base64 Fallback
                    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                    $postBody = $reader.ReadToEnd()
                    $reader.Close()

                    $uploadData = ConvertFrom-Json $postBody
                    $rawName = [System.IO.Path]::GetFileName($uploadData.filename)
                    $safeName = ($rawName -replace '[^a-zA-Z0-9_\.-]', '_').ToLower()
                    if (-not ($safeName.Trim('_.'))) { $safeName = "media_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ".bin" }

                    $uploadExt = [System.IO.Path]::GetExtension($safeName).ToLower()
                    if ($allowedUploadExts -notcontains $uploadExt) {
                        $response.StatusCode = 400
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Format file tidak diizinkan"}')
                        $response.ContentType = 'application/json'
                        $response.ContentLength64 = $errBytes.Length
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                        $response.OutputStream.Flush()
                        $response.Close()
                        continue
                    }

                    $targetFilePath = Join-Path $mediaDir $safeName

                    $b64 = $uploadData.base64
                    if ($b64 -match "^data:([^;]+);base64,(.+)$") {
                        $b64 = $matches[2]
                    }
                    $bytes = [System.Convert]::FromBase64String($b64)
                    [System.IO.File]::WriteAllBytes($targetFilePath, $bytes)

                    $relativeUrl = "media/alerts/" + $safeName
                    $response.StatusCode = 200
                    $resPayload = [System.Text.Encoding]::UTF8.GetBytes("{`"status`":`"ok`",`"url`":`"$relativeUrl`"}")
                    $response.ContentLength64 = $resPayload.Length
                    $response.OutputStream.Write($resPayload, 0, $resPayload.Length)
                    $response.OutputStream.Flush()
                    Write-Host "[UPLOAD JSON] Saved: $relativeUrl ($($bytes.Length) bytes)" -ForegroundColor Cyan
                }
            } catch {
                $response.StatusCode = 500
                $errMsg = "$_" -replace '"', '\"'
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
                $response.ContentLength64 = $errBytes.Length
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                $response.OutputStream.Flush()
                Write-Host "[UPLOAD ERROR] $_" -ForegroundColor Red
            }
            $response.Close()
            continue
        }

        # ============================================================
        # PROXY ENDPOINT: /proxy?url=ENCODED_URL
        # ============================================================
        if ($urlPath -eq "/proxy") {
            $targetUrl = $request.QueryString["url"]
            if (-not $targetUrl) {
                $response.StatusCode = 400
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Missing url parameter"}')
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.Close()
                continue
            }

            if (-not (Test-LocalOrigin $request)) {
                $response.StatusCode = 403
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Forbidden origin"}')
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.Close()
                continue
            }

            # SSRF guard: hanya host YouTube yang boleh di-proxy
            $hostOnly = ''
            $protoOnly = ''
            try {
                $uriObj = [System.Uri]$targetUrl
                $hostOnly = $uriObj.Host
                $protoOnly = $uriObj.Scheme
            } catch {
                $hostOnly = ''
                $protoOnly = ''
            }
            if ($protoOnly -ne "http" -and $protoOnly -ne "https") {
                $response.StatusCode = 400
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Invalid protocol"}')
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.Close()
                continue
            }
            if ($allowedProxyHosts -notcontains $hostOnly) {
                $response.StatusCode = 403
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Host not allowed"}')
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.Close()
                continue
            }

            Write-Host "[PROXY][$($request.HttpMethod)] $targetUrl" -ForegroundColor Magenta

            try {
                $httpRequest = [System.Net.HttpWebRequest]::Create($targetUrl)
                $httpRequest.Method = $request.HttpMethod
                $httpRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
                $httpRequest.Headers.Add("Accept-Language", "en-US,en;q=0.9")
                $httpRequest.CookieContainer = $global:cookieContainer
                $httpRequest.Timeout = 12000
                $httpRequest.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate

                if ($request.HttpMethod -eq "POST") {
                    $httpRequest.ContentType = "application/json"
                    $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
                    $postBody = $reader.ReadToEnd()
                    $reader.Close()
                    
                    $postBytes = [System.Text.Encoding]::UTF8.GetBytes($postBody)
                    $httpRequest.ContentLength = $postBytes.Length
                    $requestStream = $httpRequest.GetRequestStream()
                    $requestStream.Write($postBytes, 0, $postBytes.Length)
                    $requestStream.Close()
                }

                $httpResponse = $httpRequest.GetResponse()
                $reader = New-Object System.IO.StreamReader($httpResponse.GetResponseStream(), [System.Text.Encoding]::UTF8)
                $proxyResult = $reader.ReadToEnd()
                $reader.Close()
                $httpResponse.Close()

                $resultBytes = [System.Text.Encoding]::UTF8.GetBytes($proxyResult)
                $upstreamContentType = $httpResponse.ContentType
                if (-not $upstreamContentType) {
                    if ($targetUrl -match '\.json|\/api\/|get_live_chat') {
                        $upstreamContentType = "application/json; charset=utf-8"
                    } elseif ($targetUrl -match '\.txt') {
                        $upstreamContentType = "text/plain; charset=utf-8"
                    } else {
                        $upstreamContentType = "text/html; charset=utf-8"
                    }
                }
                $response.ContentType = $upstreamContentType
                $response.StatusCode = 200
                $response.ContentLength64 = $resultBytes.Length
                $response.OutputStream.Write($resultBytes, 0, $resultBytes.Length)
                $response.OutputStream.Flush()

                Write-Host "[PROXY] OK - $($resultBytes.Length) bytes" -ForegroundColor Green
            } catch {
                Write-Host "[PROXY] ERROR: $_" -ForegroundColor Red
                $response.StatusCode = 502
                $errMsg = "$_" -replace '"', '\"'
                $errorBytes = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`"}")
                $response.ContentLength64 = $errorBytes.Length
                $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                $response.OutputStream.Flush()
            }

            $response.Close()
            continue
        }

        # ============================================================
        # STATIC FILE SERVER
        # ============================================================
        if ($urlPath -eq "/" -or $urlPath -eq "") {
            $urlPath = "/index.html"
        }

        $filePath = Join-Path $rootDir ($urlPath -replace '/', '\')

        # Path-traversal guard: pastikan path tetap di dalam rootDir
        $rootFull = ([System.IO.Path]::GetFullPath($rootDir)).TrimEnd('\')
        $fullPath = [System.IO.Path]::GetFullPath($filePath)
        if (-not $fullPath.StartsWith($rootFull + '\')) {
            $response.StatusCode = 404
            $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("<h1>404 Not Found</h1>")
            $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            $response.Close()
            continue
        }

        # Null byte and stream colon checks prevent path parsing errors and NTFS stream leakage
        if ($fullPath.Contains("`0") -or ($fullPath.Substring($rootFull.Length).Contains(':'))) {
            $response.StatusCode = 400
            $badPathBytes = [System.Text.Encoding]::UTF8.GetBytes("Bad request path")
            $response.OutputStream.Write($badPathBytes, 0, $badPathBytes.Length)
            $response.Close()
            continue
        }

        # Token config and server scripts must not be served raw through static routing.
        $lowerUrl = $urlPath.ToLower()
        $fileName = [System.IO.Path]::GetFileName($filePath).ToLower()
        $fileExt = [System.IO.Path]::GetExtension($filePath).ToLower()
        $blockedExts = @('.ps1', '.bat', '.cmd', '.key', '.pem')
        $blockedFiles = @('config.json', 'migrasi_zover.txt', 'prd_update_zover.txt', 'update_zover_prd.txt')

        if (
            $blockedFiles -contains $fileName -or
            $blockedExts -contains $fileExt -or
            $lowerUrl.StartsWith('/.git/') -or
            $lowerUrl -eq '/.git' -or
            $lowerUrl.Contains('/node_modules/') -or
            $fullPath.ToLower().Contains('\node_modules\') -or
            $fullPath.ToLower().Contains('\.git\')
        ) {
            $response.StatusCode = 404
            $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("<h1>404 Not Found</h1>")
            $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            $response.Close()
            continue
        }

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = $mimeTypes[$ext]
            if (-not $mime) { $mime = 'application/octet-stream' }

            $response.ContentType = $mime
            $response.StatusCode = 200
            $response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")
            $response.AddHeader("Pragma", "no-cache")
            $response.AddHeader("Expires", "0")

            $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $fileBytes.Length
            $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
            $response.OutputStream.Flush()

            Write-Host "[FILE] $urlPath ($($fileBytes.Length) bytes)" -ForegroundColor DarkGray
        } else {
            $response.StatusCode = 404
            $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("<h1>404 Not Found</h1><p>$urlPath</p>")
            $response.ContentLength64 = $notFoundBytes.Length
            $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            $response.OutputStream.Flush()
            Write-Host "[404] $urlPath" -ForegroundColor Yellow
        }

        $response.Close()
    } catch {
        Write-Host "[ERROR] $_" -ForegroundColor Red
    }
}
