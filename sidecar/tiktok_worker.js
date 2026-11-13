/**
 * ZoVer v3.0 Ingestion Sidecar - Dedicated TikTok Live Worker (Open Source via tiklive)
 * Terisolasi dalam proses terpisah. Menghubungkan WebSocket ke Rust Core (ws://127.0.0.1:8765/api/worker/tiktok).
 * Menggunakan `tiklive/core` (open-source, tanpa EulerStream / tanpa layanan signing berbayar).
 */

const WebSocket = require('ws');

let hubUrl = process.env.ZOVER_HUB_WS || 'ws://127.0.0.1:8765/api/worker/tiktok';
if (process.env.ZOVER_WORKER_TOKEN && !hubUrl.includes('token=')) {
  hubUrl += `${hubUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(process.env.ZOVER_WORKER_TOKEN)}`;
}

let hubWs = null;
let activeFiber = null;
let activeSessionToken = 0;
let activeUsername = '';
let activeRoomId = null;
let isSessionConnected = false;
let isSessionConnecting = false;
let tikliveDepsPromise = null;

function loadTikliveDeps() {
  if (!tikliveDepsPromise) {
    tikliveDepsPromise = Promise.all([
      import('tiklive/core'),
      import('effect')
    ]).then(([tikliveCore, effectLib]) => ({
      LiveConnection: tikliveCore.LiveConnection,
      Effect: effectLib.Effect,
      Stream: effectLib.Stream,
      Fiber: effectLib.Fiber
    }));
  }
  return tikliveDepsPromise;
}

function connectToRustHub() {
  hubWs = new WebSocket(hubUrl);

  hubWs.on('open', () => {
    console.log('[Sidecar] Terhubung ke ZoVer Rust Broadcast Hub.');
    const targetUser = process.argv[2] || process.env.TIKTOK_USER;
    if (targetUser && targetUser.trim().replace(/^@/, '').toLowerCase() !== activeUsername) {
      startTikTokSession(targetUser);
    }
  });

  hubWs.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'connect' && msg.username) {
        startTikTokSession(msg.username);
      } else if (msg.action === 'disconnect') {
        stopTikTokSession();
      }
    } catch (_) {}
  });

  hubWs.on('close', () => {
    console.warn('[Sidecar] Terputus dari Rust Hub. Mencoba menyambung kembali dalam 3s...');
    setTimeout(connectToRustHub, 3000);
  });

  hubWs.on('error', err => {
    console.warn('[Sidecar Hub Error]:', err.message);
  });
}

function sendToHub(payload) {
  if (hubWs && hubWs.readyState === WebSocket.OPEN) {
    hubWs.send(JSON.stringify(payload));
  }
}

async function stopTikTokSession(emitStatus = true) {
  activeSessionToken += 1;
  const fiberToStop = activeFiber;
  activeFiber = null;
  activeUsername = '';
  activeRoomId = null;
  isSessionConnected = false;
  isSessionConnecting = false;

  if (fiberToStop) {
    try {
      const { Effect, Fiber } = await loadTikliveDeps();
      await Effect.runPromise(Fiber.interrupt(fiberToStop));
    } catch (_) {}
  }

  if (emitStatus) {
    sendToHub({
      type: 'status',
      status: 'disconnected',
      platform: 'tiktok'
    });
  }
}

function handleTikliveEvent(ev) {
  if (!ev || !ev.type) return;

  switch (ev.type) {
    case 'chat':
      sendToHub({
        type: 'chat',
        platform: 'tiktok',
        data: {
          msgId: ev.msgId || `tt_${ev.timestamp || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          uniqueId: ev.user?.uniqueId || '',
          nickname: ev.user?.nickname || ev.user?.uniqueId || 'Penonton TikTok',
          comment: ev.comment || '',
          profilePictureUrl: ev.user?.profilePictureUrl || '',
          isModerator: Boolean(ev.user?.isModerator),
          isSubscriber: Boolean(ev.user?.isSubscriber),
          gifterLevel: Number(ev.user?.gifterLevel) || 0
        }
      });
      break;

    case 'gift':
      sendToHub({
        type: 'gift',
        platform: 'tiktok',
        data: {
          msgId: ev.msgId || '',
          giftId: ev.giftId,
          giftName: ev.giftName || 'Gift',
          giftPictureUrl: ev.giftImageUrl || '',
          repeatCount: Number(ev.repeatCount) || 1,
          repeatEnd: !ev.streaking,
          giftType: 1,
          diamondCount: Number(ev.diamondCount) || 0,
          uniqueId: ev.user?.uniqueId || '',
          nickname: ev.user?.nickname || ev.user?.uniqueId || 'Penonton TikTok',
          profilePictureUrl: ev.user?.profilePictureUrl || ''
        }
      });
      break;

    case 'like':
      sendToHub({
        type: 'like',
        platform: 'tiktok',
        data: {
          likeCount: Number(ev.likeCount) || 1,
          totalLikes: ev.totalLikeCount !== undefined ? Number(ev.totalLikeCount) : undefined,
          uniqueId: ev.user?.uniqueId || '',
          nickname: ev.user?.nickname || ev.user?.uniqueId || 'Penonton TikTok',
          profilePictureUrl: ev.user?.profilePictureUrl || ''
        }
      });
      break;

    case 'follow':
      sendToHub({
        type: 'follow',
        platform: 'tiktok',
        data: {
          uniqueId: ev.user?.uniqueId || '',
          nickname: ev.user?.nickname || ev.user?.uniqueId || 'Follower Baru',
          profilePictureUrl: ev.user?.profilePictureUrl || ''
        }
      });
      break;

    case 'viewers':
      sendToHub({
        type: 'viewers',
        platform: 'tiktok',
        data: {
          viewerCount: Number(ev.viewerCount) || 0
        }
      });
      break;

    case 'streamEnd':
      console.log('[Sidecar] Stream TikTok telah berakhir.');
      stopTikTokSession(true);
      break;
  }
}

async function startTikTokSession(username) {
  const normalizedUser = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!normalizedUser) return;

  // Reuse active session when another overlay/client connects for the same channel
  if (activeFiber && activeUsername === normalizedUser && (isSessionConnected || isSessionConnecting)) {
    if (isSessionConnected) {
      sendToHub({
        type: 'status',
        status: 'connected',
        platform: 'tiktok',
        roomId: activeRoomId,
        username: activeUsername
      });
    }
    return;
  }

  await stopTikTokSession(false);

  let deps;
  try {
    deps = await loadTikliveDeps();
  } catch (err) {
    sendToHub({
      type: 'error',
      platform: 'tiktok',
      message: `Module tiklive tidak tersedia: ${err.message}`
    });
    return;
  }

  const { LiveConnection, Effect, Stream } = deps;
  const sessionToken = activeSessionToken;
  activeUsername = normalizedUser;
  isSessionConnecting = true;
  console.log(`[Sidecar] Memulai koneksi TikTok Live (tiklive open-source) ke @${activeUsername}...`);

  const connectionStream = LiveConnection.connect(activeUsername, {
    includeHistory: false,
    reconnect: {
      maxAttempts: 10,
      maxDelay: '30 seconds'
    }
  });

  const program = Stream.runForEach(connectionStream, connEvent =>
    Effect.sync(() => {
      if (sessionToken !== activeSessionToken) return;

      if (connEvent._tag === 'Connected') {
        isSessionConnecting = false;
        isSessionConnected = true;
        activeRoomId = connEvent.roomId;
        console.log(`[Sidecar] Sukses terhubung ke Room ID: ${connEvent.roomId} (via ${connEvent.wsHost})`);
        sendToHub({
          type: 'status',
          status: 'connected',
          platform: 'tiktok',
          roomId: connEvent.roomId,
          username: activeUsername
        });
        if (connEvent.room && typeof connEvent.room.viewerCount === 'number') {
          sendToHub({
            type: 'viewers',
            platform: 'tiktok',
            data: { viewerCount: connEvent.room.viewerCount }
          });
        }
      } else if (connEvent._tag === 'Event') {
        handleTikliveEvent(connEvent.event);
      } else if (connEvent._tag === 'Disconnected') {
        if (!connEvent.willReconnect) {
          console.log(`[Sidecar] Sesi TikTok terputus (${connEvent.reason}).`);
          stopTikTokSession(true);
        } else {
          console.warn(`[Sidecar] Koneksi TikTok terputus (${connEvent.reason}), mencoba reconnect...`);
        }
      }
    })
  ).pipe(
    Effect.provide(LiveConnection.layer()),
    Effect.catch(err =>
      Effect.sync(() => {
        if (sessionToken !== activeSessionToken) return;
        isSessionConnecting = false;
        isSessionConnected = false;
        activeFiber = null;
        const rawMsg = err?.message || err?._tag || 'Koneksi ke TikTok Live gagal';
        console.error('[Sidecar] Gagal menghubungkan ke TikTok:', rawMsg);
        sendToHub({
          type: 'error',
          platform: 'tiktok',
          message: rawMsg
        });
      })
    )
  );

  activeFiber = Effect.runFork(program);
}

// Mulai hub listener
connectToRustHub();
