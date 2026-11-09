/**
 * ZoVer v3.0 Ingestion Sidecar - Dedicated TikTok Live Worker
 * Terisolasi dalam proses terpisah. Menghubungkan WebSocket ke Rust Core (ws://127.0.0.1:8765/api/worker/tiktok).
 */

const WebSocket = require('ws');

let LiveConnector = null;
try {
  const { TikTokLiveConnection, WebcastPushConnection } = require('tiktok-live-connector');
  LiveConnector = TikTokLiveConnection || WebcastPushConnection || null;
} catch (_) {
  console.error('[Sidecar] Module tiktok-live-connector tidak ditemukan.');
}

const RUST_HUB_URL = process.env.ZOVER_HUB_WS || 'ws://127.0.0.1:8765/api/worker/tiktok';
let hubWs = null;
let tiktokConn = null;
let activeUsername = '';

function connectToRustHub() {
  hubWs = new WebSocket(RUST_HUB_URL);

  hubWs.on('open', () => {
    console.log('[Sidecar] Terhubung ke ZoVer Rust Broadcast Hub.');
    // Minta target koneksi jika ada argumen CLI
    const targetUser = process.argv[2] || process.env.TIKTOK_USER;
    if (targetUser && targetUser !== activeUsername) {
      startTikTokSession(targetUser);
    }
  });

  hubWs.on('message', data => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === 'connect' && msg.username) {
        startTikTokSession(msg.username, msg.sessionId);
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

function stopTikTokSession() {
  if (tiktokConn) {
    try {
      tiktokConn.disconnect();
    } catch (_) {}
    tiktokConn = null;
  }
  activeUsername = '';
  sendToHub({
    type: 'status',
    status: 'disconnected',
    platform: 'tiktok'
  });
}

function startTikTokSession(username, sessionId = '') {
  stopTikTokSession();
  if (!LiveConnector) {
    sendToHub({
      type: 'error',
      platform: 'tiktok',
      message: 'Library tiktok-live-connector tidak terpasang di runtime sidecar.'
    });
    return;
  }

  activeUsername = username.trim().replace(/^@/, '');
  console.log(`[Sidecar] Memulai koneksi TikTok Live ke @${activeUsername}...`);

  const options = {
    enableExtendedGiftInfo: true,
    processInitialData: true,
    requestPollingIntervalMs: 1000
  };

  if (sessionId) {
    options.sessionId = sessionId;
  }

  tiktokConn = new LiveConnector(activeUsername, options);

  tiktokConn.connect().then(state => {
    console.log(`[Sidecar] Sukses terhubung ke Room ID: ${state.roomId}`);
    sendToHub({
      type: 'status',
      status: 'connected',
      platform: 'tiktok',
      roomId: state.roomId,
      username: activeUsername
    });
  }).catch(err => {
    console.error(`[Sidecar] Gagal menghubungkan ke TikTok:`, err.message);
    sendToHub({
      type: 'error',
      platform: 'tiktok',
      message: err.message || 'Koneksi ke TikTok Live gagal'
    });
  });

  tiktokConn.on('chat', data => {
    sendToHub({
      type: 'chat',
      platform: 'tiktok',
      data: {
        msgId: data.common?.msgId || data.msgId,
        uniqueId: data.user?.displayId || data.uniqueId,
        nickname: data.user?.nickname || data.nickname,
        profilePictureUrl: data.user?.avatarThumb?.urlList?.[0] || data.profilePictureUrl,
        comment: data.content || data.comment,
        createTime: data.common?.createTime || Date.now()
      }
    });
  });

  tiktokConn.on('gift', data => {
    sendToHub({
      type: 'gift',
      platform: 'tiktok',
      data: {
        giftId: data.giftId,
        giftName: data.giftName || data.gift?.name,
        repeatCount: data.repeatCount || data.count || 1,
        diamondCount: data.diamondCount || 0,
        uniqueId: data.user?.displayId || data.uniqueId,
        nickname: data.user?.nickname || data.nickname,
        profilePictureUrl: data.user?.avatarThumb?.urlList?.[0] || data.profilePictureUrl,
        giftPictureUrl: data.giftPictureUrl || data.gift?.image?.urlList?.[0] || ''
      }
    });
  });

  tiktokConn.on('like', data => {
    sendToHub({
      type: 'like',
      platform: 'tiktok',
      data: {
        likeCount: data.likeCount || 1,
        totalLikes: data.totalLikes,
        uniqueId: data.user?.displayId || data.uniqueId,
        nickname: data.user?.nickname || data.nickname,
        profilePictureUrl: data.user?.avatarThumb?.urlList?.[0] || data.profilePictureUrl
      }
    });
  });

  tiktokConn.on('follow', data => {
    sendToHub({
      type: 'follow',
      platform: 'tiktok',
      data: {
        uniqueId: data.user?.displayId || data.uniqueId,
        nickname: data.user?.nickname || data.nickname,
        profilePictureUrl: data.user?.avatarThumb?.urlList?.[0] || data.profilePictureUrl
      }
    });
  });

  tiktokConn.on('roomUser', data => {
    sendToHub({
      type: 'viewers',
      platform: 'tiktok',
      data: {
        viewerCount: data.viewerCount || data.user_count || 0
      }
    });
  });

  tiktokConn.on('streamEnd', () => {
    console.log('[Sidecar] Stream TikTok telah berakhir.');
    stopTikTokSession();
  });
}

// Mulai hub listener
connectToRustHub();
