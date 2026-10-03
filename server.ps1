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
    Write-Host ""
    Write-Host "[INFO] Server Multi-Chat Overlay SUDAH BERJALAN di latar belakang / jendela lain!" -ForegroundColor Yellow
    Write-Host "Port $port sudah aktif melayani http://localhost:$port" -ForegroundColor Cyan
    Write-Host "Anda tidak perlu membuka jendela server ganda. Cukup buka browser di: http://localhost:$port" -ForegroundColor Green
    Write-Host ""
    Write-Host "Jika ingin merestart server, tutup semua jendela server lalu jalankan kembali." -ForegroundColor Gray
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

# Tolak request lintas-origin (CSRF) kecuali dari server localhost ini sendiri.
# Request non-browser (curl) tanpa header Origin tetap diizinkan.
function Test-LocalOrigin($req) {
    $origin = $req.Headers["Origin"]
    if (-not $origin) { return $true }
    return ($origin -eq "http://localhost:$port" -or $origin -eq "http://127.0.0.1:$port")
}

# Hanya izinkan proxy ke host platform yang didukung (cegah SSRF / open-proxy)
$allowedProxyHosts = @('www.youtube.com', 'youtube.com', 'm.youtube.com', 'kick.com', 'www.kick.com', 'tiktok.com', 'www.tiktok.com')

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

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
                if (Test-Path $configFile) {
                    $configBytes = [System.IO.File]::ReadAllBytes($configFile)
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

                if ($queryFilename) {
                    # 1. HIGH-SPEED DIRECT BINARY STREAMING (0.1 detik, tanpa lag Base64)
                    $cleanName = [System.IO.Path]::GetFileName([System.Uri]::UnescapeDataString($queryFilename))
                    $safeName = ($cleanName -replace '[^a-zA-Z0-9_\.-]', '_').ToLower()
                    if (-not ($safeName.Trim('_.'))) { $safeName = "media_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ".bin" }

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
            try { $hostOnly = ([System.Uri]$targetUrl).Host } catch { $hostOnly = '' }
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
