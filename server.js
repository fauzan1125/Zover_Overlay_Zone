const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastPushConnection } = require('tiktok-live-connector');
const LiveConnector = TikTokLiveConnection || WebcastPushConnection;

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
  const base = path.basename(decodeURIComponent(name || ''));
  const cleaned = base.replace(/[^a-zA-Z0-9_\.-]/g, '_').toLowerCase();
  if (!cleaned.replace(/[_\.]/g, '')) {
    return `media_${Date.now()}.bin`;
  }
  return cleaned;
}

const server = http.createServer((req, res) => {
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
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(err ? '{}' : data);
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
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        fs.writeFile(configFile, body, 'utf8', err => {
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
      const matched = eventQueue.filter(item => (item.timestamp || 0) > since);
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
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          if (!payload.timestamp) {
            payload.timestamp = Date.now();
          }
          eventQueue.push(payload);
          while (eventQueue.length > 100) {
            eventQueue.shift();
          }
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok' }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        }
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
      const targetPath = path.join(uploadDir, safeName);
      const writeStream = fs.createWriteStream(targetPath);

      req.pipe(writeStream);
      writeStream.on('finish', () => {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', url: `media/alerts/${safeName}` }));
      });
      writeStream.on('error', err => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const safeName = sanitizeFilename(data.filename);
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
          res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: err.message }));
        });
      });

      proxyReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err.message }));
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Proxy request timeout' }));
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
  filePath = path.join(ROOT_DIR, decodeURIComponent(filePath));

  if (!filePath.startsWith(ROOT_DIR)) {
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

    fs.createReadStream(filePath).pipe(res);
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
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
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const rawUsername = parsedUrl.searchParams.get('username') || '';
  const cleanUsername = rawUsername.replace(/^@/, '').trim();
  const sessionId = parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('token') || '';

  if (!cleanUsername) {
    ws.send(JSON.stringify({ type: 'error', message: 'TikTok username is required' }));
    ws.close();
    return;
  }

  const rawSessionId = parsedUrl.searchParams.get('sessionId') || parsedUrl.searchParams.get('token') || '';
  // Only pass to TikTok if it looks like a TikTok web sessionid (32-character hex) and not an IndoFinity token
  const validSessionId = (/^[0-9a-fA-F]{32}$/.test(rawSessionId) && !rawSessionId.includes('-')) ? rawSessionId : undefined;

  let isClosed = false;

  const tiktokLive = new LiveConnector(cleanUsername, {
    processInitialData: false,
    sessionId: validSessionId
  });

  const sendJson = payload => {
    if (!isClosed && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  tiktokLive.on('connected', state => {
    sendJson({ type: 'status', status: 'connected', roomId: state.roomId });
  });

  tiktokLive.on('disconnected', () => {
    sendJson({ type: 'status', status: 'disconnected' });
  });

  tiktokLive.on('streamEnd', () => {
    sendJson({ type: 'status', status: 'disconnected' });
  });

  tiktokLive.on('error', err => {
    sendJson({ type: 'error', message: err ? err.message : 'Unknown TikTok error' });
  });

  tiktokLive.on('chat', data => {
    const msgId = data.common?.msgId || data.msgId || `tt-${Date.now()}`;
    const comment = data.content || data.comment || '';
    const uniqueId = data.user?.displayId || data.uniqueId || '';
    const nickname = data.user?.nickname || data.nickname || uniqueId;
    const profilePictureUrl = data.user?.avatarThumb?.urlListList?.[0] || data.user?.avatarMedium?.urlListList?.[0] || data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico';
    const createTime = data.common?.createTime ? Number(data.common.createTime) : (data.createTime || Date.now());

    sendJson({
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
    const profilePictureUrl = data.user?.avatarThumb?.urlListList?.[0] || data.profilePictureUrl || '';
    const giftPictureUrl = data.giftPictureUrl || data.gift?.image?.urlListList?.[0] || '';

    sendJson({
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

    sendJson({
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
    const uniqueId = data.user?.displayId || data.uniqueId || '';
    const nickname = data.user?.nickname || data.nickname || uniqueId;
    const profilePictureUrl = data.user?.avatarThumb?.urlListList?.[0] || data.profilePictureUrl || '';

    sendJson({
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
    if (data.displayType && data.displayType.includes('follow')) {
      handleFollow(data);
    }
  });

  tiktokLive.on('roomUser', data => {
    const viewerCount = data.viewerCount ?? data.count ?? data.userCount ?? 0;
    sendJson({
      type: 'viewers',
      data: {
        viewerCount
      }
    });
  });

  try {
    const conn = tiktokLive.connect();
    if (conn && typeof conn.then === 'function') {
      conn.then(s => {
        sendJson({ type: 'status', status: 'connected', roomId: s ? s.roomId : '' });
      }).catch(err => {
        sendJson({ type: 'error', message: err ? err.message : 'Connection failed' });
      });
    }
  } catch (err) {
    sendJson({ type: 'error', message: err ? err.message : 'Connection failed' });
  }

  const cleanup = () => {
    if (!isClosed) {
      isClosed = true;
      try {
        const res = tiktokLive.disconnect();
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch (_) {}
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`TikTok WebSocket ready on ws://localhost:${PORT}/ws/tiktok`);
});
