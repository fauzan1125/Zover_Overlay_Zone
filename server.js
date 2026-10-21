process.on('uncaughtException', err => {
  console.error('[Server Uncaught Exception]', err.stack || err);
});

process.on('unhandledRejection', reason => {
  console.error('[Server Unhandled Rejection]', reason);
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const zlib = require('zlib');
let WebSocketServer = null;
try {
  ({ WebSocketServer } = require('ws'));
} catch (_) {
  // Absence of optional ws module is handled gracefully below
}

let LiveConnector = null;
try {
  const { TikTokLiveConnection, WebcastPushConnection } = require('tiktok-live-connector');
  LiveConnector = TikTokLiveConnection || WebcastPushConnection || null;
} catch (_) {
  // Absence of optional tiktok module is handled gracefully in websocket connection handler
}

const PORT = 8765;
const ROOT_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webp': 'image/webp'
};

const ALLOWED_PROXY_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'kick.com',
  'www.kick.com',
  'tiktok.com',
  'www.tiktok.com'
]);

const YOUTUBE_COOKIES = 'CONSENT=PENDING+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY';

const eventQueue = [];

function isLocalOrigin(req) {
  const origin = req.headers['origin'];
  if (!origin) return true;
  return origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
}

function sanitizeFilename(name) {
  let decoded = '';
  try {
    decoded = decodeURIComponent(name || '');
  } catch (_) {
    // Malformed percent-encoding fallbacks safely without throwing URIError
    return `media_${Date.now()}.bin`;
  }
  const base = path.basename(decoded);
  const cleaned = base.replace(/[^a-zA-Z0-9_\.-]/g, '_').toLowerCase();
  if (!cleaned.replace(/[_\.]/g, '')) {
    return `media_${Date.now()}.bin`;
  }
  return cleaned;
}

const ALLOWED_HOSTS = new Set([
  `localhost:${PORT}`,
  `127.0.0.1:${PORT}`,
  'localhost',
  '127.0.0.1'
]);

// Hanya media alert yang boleh diupload; .html/.js ditolak agar tidak jadi XSS satu origin
const ALLOWED_UPLOAD_EXTS = new Set([
  '.mp3', '.wav', '.ogg', '.m4a', '.aac',
  '.mp4', '.webm', '.mov',
  '.gif', '.png', '.jpg', '.jpeg', '.webp',
  '.bin'
]);

function isValidHost(req) {
  const host = (req.headers['host'] || '').trim().toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

const server = http.createServer((req, res) => {
  // Reject unexpected host headers to protect against DNS rebinding attacks.
  if (!isValidHost(req)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid Host header');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/config') {
    const configFile = path.join(ROOT_DIR, 'config.json');

    if (req.method === 'GET') {
      fs.readFile(configFile, (err, data) => {
        if (!err) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(data);
          return;
        }
        // Fallback to config.example.json so clean installations load valid defaults.
        const exampleFile = path.join(ROOT_DIR, 'config.example.json');
        fs.readFile(exampleFile, (exErr, exData) => {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(exErr ? '{}' : exData);
        });
      });
      return;
    }

    if (req.method === 'POST') {
      if (!isLocalOrigin(req)) {
        res.writeHead(403);
        res.end();
        return;
      }

      let body = '';
      let oversize = false;
      req.on('data', chunk => {
        body += chunk;
        // config asli hanya puluhan KB; batasi agar request rusak tidak merusak config.json
        if (body.length > 2 * 1024 * 1024) {
          oversize = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (oversize) return;

        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Invalid JSON config' }));
          return;
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Config must be a JSON object' }));
          return;
        }

        fs.writeFile(configFile, JSON.stringify(parsed), 'utf8', err => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
      });
      return;
    }
  }

  if (pathname === '/api/events') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'GET') {
      const since = parseInt(parsedUrl.searchParams.get('since') || '0', 10) || 0;
      // >= supaya event yang masuk pada milidetik yang sama tidak hilang.
      // Retensi queue 5 detik (lihat POST di bawah) selalu lebih pendek dari
      // window dedup client, jadi replay event yang sama tidak memicu alert ganda
      const matched = eventQueue.filter(item => (item.timestamp || 0) >= since);
      res.writeHead(200);
      res.end(JSON.stringify(matched));
      return;
    }

    if (req.method === 'POST') {
      if (!isLocalOrigin(req)) {
        res.writeHead(403);
        res.end();
        return;
      }

      let body = '';
      let oversize = false;
      req.on('data', chunk => {
        body += chunk;
        // Limit events payload to prevent unbounded memory allocation.
        if (body.length > 256 * 1024) {
          oversize = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (oversize) return;

        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
          return;
        }

        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Payload must be a JSON object' }));
          return;
        }

        if (!payload.timestamp) {
          payload.timestamp = Date.now();
        }
        eventQueue.push(payload);
        while (eventQueue.length > 100) {
          eventQueue.shift();
        }
        while (eventQueue.length && Date.now() - (eventQueue[0].timestamp || 0) > 5000) {
          eventQueue.shift();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
      return;
    }
  }

  if (pathname === '/api/upload') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    if (!isLocalOrigin(req)) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden origin' }));
      return;
    }

    const uploadDir = path.join(ROOT_DIR, 'media', 'alerts');
    fs.mkdirSync(uploadDir, { recursive: true });

    const rawFilename = parsedUrl.searchParams.get('filename') || req.headers['x-filename'];

    if (rawFilename) {
      const safeName = sanitizeFilename(rawFilename);
      if (!ALLOWED_UPLOAD_EXTS.has(path.extname(safeName))) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Format file tidak diizinkan' }));
        return;
      }
      const targetPath = path.join(uploadDir, safeName);
      const writeStream = fs.createWriteStream(targetPath);
      let totalBytes = 0;
      let oversize = false;

      // Restrict upload size to 100 MB to prevent disk exhaustion attacks.
      const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

      req.on('data', chunk => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_UPLOAD_BYTES && !oversize) {
          oversize = true;
          req.unpipe(writeStream);
          writeStream.destroy();
          fs.unlink(targetPath, () => {});
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload too large' }));
          }
        }
      });

      req.on('error', () => {
        writeStream.destroy();
        fs.unlink(targetPath, () => {});
      });

      req.pipe(writeStream);
      writeStream.on('finish', () => {
        if (oversize) return;
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', url: `media/alerts/${safeName}` }));
      });
      writeStream.on('error', err => {
        if (oversize) return;
        fs.unlink(targetPath, () => {});
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const safeName = sanitizeFilename(data.filename);
        if (!ALLOWED_UPLOAD_EXTS.has(path.extname(safeName))) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Format file tidak diizinkan' }));
          return;
        }
        let base64Data = data.base64 || '';
        const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          base64Data = match[2];
        }

        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFile(path.join(uploadDir, safeName), buffer, err => {
          if (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', url: `media/alerts/${safeName}` }));
        });
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/proxy') {
    const targetUrl = parsedUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }

    if (!isLocalOrigin(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Forbidden origin' }));
      return;
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid target url' }));
      return;
    }

    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid protocol' }));
      return;
    }

    if (!ALLOWED_PROXY_HOSTS.has(parsedTarget.hostname)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Host not allowed' }));
      return;
    }

    let bodyBuffer = null;
    const fetchProxy = () => {
      const isHttps = parsedTarget.protocol === 'https:';
      const client = isHttps ? https : http;

      const proxyHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': YOUTUBE_COOKIES,
        'Accept-Encoding': 'gzip, deflate'
      };

      if (req.method === 'POST') {
        proxyHeaders['Content-Type'] = 'application/json';
        proxyHeaders['Content-Length'] = bodyBuffer ? bodyBuffer.length : 0;
      }

      const proxyReq = client.request(parsedTarget, {
        method: req.method,
        headers: proxyHeaders,
        timeout: 12000
      }, proxyRes => {
        let stream = proxyRes;
        const encoding = proxyRes.headers['content-encoding'];
        if (encoding === 'gzip') {
          stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = proxyRes.pipe(zlib.createInflate());
        }

        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const finalBuffer = Buffer.concat(chunks);
          let upstreamType = proxyRes.headers['content-type'];
          if (!upstreamType) {
            if (targetUrl.includes('.json') || targetUrl.includes('/api/') || targetUrl.includes('get_live_chat')) {
              upstreamType = 'application/json; charset=utf-8';
            } else if (targetUrl.includes('.txt')) {
              upstreamType = 'text/plain; charset=utf-8';
            } else {
              upstreamType = 'text/html; charset=utf-8';
            }
          }

          res.writeHead(proxyRes.statusCode || 200, {
            'Content-Type': upstreamType,
            'Content-Length': finalBuffer.length
          });
          res.end(finalBuffer);
        });
        stream.on('error', err => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      proxyReq.on('error', err => {
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Proxy request timeout' }));
        }
      });

      if (bodyBuffer) {
        proxyReq.write(bodyBuffer);
      }
      proxyReq.end();
    };

    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        bodyBuffer = Buffer.concat(chunks);
        fetchProxy();
      });
    } else {
      fetchProxy();
    }
    return;
  }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    filePath = path.join(ROOT_DIR, decodeURIComponent(filePath));
  } catch {
    // percent-encoding rusak (%zz) tanpa guard akan melempar URIError dan menggantung koneksi
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request encoding');
    return;
  }

  // startsWith saja meloloskan folder sibling berawalan sama (mis. chat_yt_kick_tiktok_backup)
  if (filePath !== ROOT_DIR && !filePath.startsWith(ROOT_DIR + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  // Null byte and stream colon checks prevent synchronous fs.stat crashes and NTFS stream leakage
  if (filePath.includes('\0') || filePath.slice(ROOT_DIR.length).includes(':')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request path');
    return;
  }

  // Token config and server scripts must not be served raw through static routing.
  const lowerPath = pathname.toLowerCase();
  const lowerFile = path.basename(filePath).toLowerCase();
  const fileExt = path.extname(filePath).toLowerCase();
  const blockedExtensions = new Set(['.ps1', '.bat', '.cmd', '.key', '.pem']);
  const blockedFiles = new Set(['config.json', 'migrasi_zover.txt', 'prd_update_zover.txt', 'update_zover_prd.txt']);

  if (
    blockedFiles.has(lowerFile) ||
    blockedExtensions.has(fileExt) ||
    lowerPath.startsWith('/.git/') ||
    lowerPath === '/.git' ||
    lowerPath.includes('/node_modules/') ||
    filePath.toLowerCase().includes(path.sep + 'node_modules' + path.sep) ||
    filePath.toLowerCase().includes(path.sep + '.git' + path.sep)
  ) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1>');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404 Not Found</h1><p>${pathname}</p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    const fileStream = fs.createReadStream(filePath);
    fileStream.on('error', err => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('File read error');
      }
    });
    fileStream.pipe(res);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[PERINGATAN] Port ${PORT} sudah digunakan oleh proses lain (server ZoVer sudah berjalan di jendela lain)!`);
    console.error(`Jika ingin memulai ulang, jalankan STOP_SERVER.bat atau tutup jendela server sebelumnya terlebih dahulu.\n`);
    process.exit(1);
  } else {
    console.error('[HTTP Server Error]', err);
  }
});

// Centralized TikTok connection pool to share one upstream session across multiple overlay sockets
const activeTikTokRooms = new Map();

function getOrCreateTikTokRoom(username, sessionId) {
  if (!LiveConnector) return null;
  const key = username.toLowerCase();
  let room = activeTikTokRooms.get(key);
  if (room) {
    if (room.disconnectTimer) {
      clearTimeout(room.disconnectTimer);
      room.disconnectTimer = null;
    }
    // Existing room instance is reused without reconnecting to avoid stream dropouts.
    return room;
  }

  const tiktokLive = new LiveConnector(username, {
    processInitialData: false,
    sessionId: sessionId
  });

  room = {
    username,
    hasSession: Boolean(sessionId),
    connector: tiktokLive,
    clients: new Set(),
    lastStatus: null,
    lastViewers: null,
    disconnectTimer: null,
    followedUsers: new Set()
  };

  const broadcast = payload => {
    for (const client of room.clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(JSON.stringify(payload));
        } catch (_) {}
      }
    }
  };

  tiktokLive.on('connected', state => {
    room.lastStatus = { type: 'status', status: 'connected', roomId: state.roomId };
    broadcast(room.lastStatus);
  });

  tiktokLive.on('disconnected', () => {
    room.lastStatus = { type: 'status', status: 'disconnected' };
    broadcast(room.lastStatus);
  });

  tiktokLive.on('streamEnd', () => {
    room.lastStatus = { type: 'status', status: 'disconnected' };
    broadcast(room.lastStatus);
  });

  tiktokLive.on('error', err => {
    broadcast({ type: 'error', message: err ? err.message : 'Unknown TikTok error' });
  });

  tiktokLive.on('chat', data => {
    const msgId = data.common?.msgId || data.msgId || `tt-${Date.now()}`;
    const comment = data.content || data.comment || '';
    const uniqueId = data.user?.displayId || data.uniqueId || '';
    const nickname = data.user?.nickname || data.nickname || uniqueId;
    const profilePictureUrl = data.user?.avatarThumb?.urlList?.[0] || data.user?.avatarMedium?.urlList?.[0] || data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico';
    const createTime = data.common?.createTime ? Number(data.common.createTime) : (data.createTime || Date.now());

    broadcast({
      type: 'chat',
      data: {
        msgId,
        uniqueId,
        nickname,
        profilePictureUrl,
        comment,
        createTime
      }
    });
  });

  tiktokLive.on('gift', data => {
    const giftId = data.giftId || data.gift?.id;
    const giftName = data.giftName || data.gift?.name || 'Gift';
    const repeatCount = data.repeatCount || data.count || data.comboCount || 1;
    const repeatEnd = data.repeatEnd ?? (data.giftType === 1 ? false : true);
    const giftType = data.giftType || (data.gift?.type ?? 0);
    const diamondCount = data.diamondCount || data.gift?.diamondCount || 0;
    const uniqueId = data.user?.displayId || data.uniqueId || '';
    const nickname = data.user?.nickname || data.nickname || uniqueId;
    const profilePictureUrl = data.user?.avatarThumb?.urlList?.[0] || data.profilePictureUrl || '';
    const giftPictureUrl = data.giftPictureUrl || data.gift?.image?.urlList?.[0] || '';

    broadcast({
      type: 'gift',
      data: {
        giftId,
        giftName,
        repeatCount,
        repeatEnd,
        giftType,
        diamondCount,
        uniqueId,
        nickname,
        profilePictureUrl,
        giftPictureUrl
      }
    });
  });

  tiktokLive.on('like', data => {
    const likeCount = data.count || data.likeCount || 1;
    const totalLikeCount = data.total || data.totalLikes || data.totalLikeCount || 0;
    const uniqueId = data.user?.displayId || data.uniqueId || '';
    const nickname = data.user?.nickname || data.nickname || uniqueId;

    broadcast({
      type: 'like',
      data: {
        likeCount,
        totalLikeCount,
        uniqueId,
        nickname
      }
    });
  });

  const handleFollow = data => {
    const uniqueId = data?.user?.displayId || data?.uniqueId || '';
    if (!uniqueId || room.followedUsers.has(uniqueId)) return;
    room.followedUsers.add(uniqueId);
    const nickname = data?.user?.nickname || data?.nickname || uniqueId;
    const profilePictureUrl = data?.user?.avatarThumb?.urlList?.[0] || data?.profilePictureUrl || '';

    broadcast({
      type: 'follow',
      data: {
        uniqueId,
        nickname,
        profilePictureUrl
      }
    });
  };

  tiktokLive.on('follow', handleFollow);
  tiktokLive.on('social', data => {
    const displayType = String(data?.displayType || '').toLowerCase();
    if (displayType.includes('follow')) {
      handleFollow(data);
    }
  });

  tiktokLive.on('roomUser', data => {
    // Skip empty updates to prevent flickering zero viewcounts on the overlay.
    const rawCount = data?.viewerCount ?? data?.count ?? data?.userCount;
    if (rawCount === undefined || rawCount === null) return;
    const viewerCount = Number(rawCount) || 0;
    room.lastViewers = { type: 'viewers', data: { viewerCount } };
    broadcast(room.lastViewers);
  });

  try {
    const conn = tiktokLive.connect();
    if (conn && typeof conn.then === 'function') {
      conn.then(s => {
        room.lastStatus = { type: 'status', status: 'connected', roomId: s ? s.roomId : '' };
        broadcast(room.lastStatus);
        const initialViewers = s?.roomInfo?.user_count || s?.viewerCount || 0;
        room.lastViewers = { type: 'viewers', data: { viewerCount: initialViewers } };
        broadcast(room.lastViewers);
      }).catch(err => {
        broadcast({ type: 'error', message: err ? err.message : 'Connection failed' });
      });
    }
  } catch (err) {
    broadcast({ type: 'error', message: err ? err.message : 'Connection failed' });
  }

  activeTikTokRooms.set(key, room);
  return room;
}

if (!WebSocketServer) {
  // Absence of ws dependency leaves HTTP server operable without crashing
  console.warn('[Server] WebSocket bridge tidak tersedia (jalankan npm install)');
} else {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('error', err => {
    console.error('[WSS Error]', err);
  });

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', err => {
      console.warn('[Upgrade Socket Error]', err.message);
    });

    // Cross-origin sites must not be able to connect or hijack TikTok events.
    if (!isLocalOrigin(request)) {
      socket.destroy();
      return;
    }

    const parsedUrl = new URL(request.url, `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/ws/tiktok' || pathname === '/api/tiktok-ws') {
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    if (!LiveConnector) {
      // Rejection message warns overlay gracefully when tiktok module is missing
      ws.send(JSON.stringify({ type: 'error', message: 'tiktok-live-connector tidak terpasang (jalankan npm install)' }));
      ws.close();
      return;
    }

    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    const rawUsername = parsedUrl.searchParams.get('username') || '';
    const cleanUsername = rawUsername.replace(/^@/, '').trim();

    if (!cleanUsername) {
      ws.send(JSON.stringify({ type: 'error', message: 'TikTok username is required' }));
      ws.close();
      return;
    }

    const rawSessionId = (parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('token') || '').trim();
    // Valid sessionid is at least 32 characters alphanumeric
    const validSessionId = (/^[0-9a-zA-Z_-]{32,}$/.test(rawSessionId) && !rawSessionId.includes('.')) ? rawSessionId : undefined;

    const room = getOrCreateTikTokRoom(cleanUsername, validSessionId);
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', message: 'tiktok-live-connector tidak terpasang (jalankan npm install)' }));
      ws.close();
      return;
    }
    room.clients.add(ws);

    if (room.lastStatus && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(room.lastStatus));
    }
    if (room.lastViewers && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(room.lastViewers));
    }

    const cleanup = () => {
      room.clients.delete(ws);
      // Grace period before teardown prevents disconnect churn on page reloads
      if (room.clients.size === 0) {
        if (room.disconnectTimer) clearTimeout(room.disconnectTimer);
        room.disconnectTimer = setTimeout(() => {
          if (room.clients.size === 0) {
            try {
              const res = room.connector.disconnect();
              if (res && typeof res.catch === 'function') res.catch(() => {});
            } catch (_) {}
            activeTikTokRooms.delete(cleanUsername.toLowerCase());
          }
        }, 5000);
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
}

// Explicit error handler prevents raw stack dumps when another instance already holds the port
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[INFO] Port ${PORT} sudah digunakan oleh proses server lain.`);
    console.error(`Jalankan STOP_SERVER.bat jika Anda ingin me-restart server.`);
    process.exit(1);
  }
  console.error('[Server Error]', err);
});

server.listen(PORT, '127.0.0.1', () => {
  // Binding strictly to loopback prevents other devices on the local network from accessing local APIs.
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
  if (WebSocketServer && LiveConnector) {
    console.log(`TikTok WebSocket ready on ws://127.0.0.1:${PORT}/ws/tiktok`);
  } else if (WebSocketServer) {
    console.warn('[Server] TikTok bridge tidak tersedia (jalankan npm install)');
  }
});

