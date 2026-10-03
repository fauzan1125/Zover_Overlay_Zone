/**
 * TikTok & IndoFinity Live Chat Connector
 * Full integration for IndoFinity WebSocket (ws://127.0.0.1:62024 & ws://127.0.0.1:62824 & 62030) and Socket.IO frames.
 */

class TikTokConnector {
  constructor(onMessageCallback, onStatusCallback, onAlertCallback) {
    this.onMessage = onMessageCallback;
    this.onStatus = onStatusCallback;
    this.onAlert = onAlertCallback;
    this.username = '';
    this.apiToken = ''; // Diisi dari config/UI pengguna, jangan hardcode token di source.
    this.isConnected = false;
    this.websocket = null;
    this.pollTimer = null;
    this.seenMessageIds = new Set();
    this.isPolling = false;
    this.accumulatedLikes = 0;
    this.lastLikeMilestone = 0;
    this.lastLikeAlertTime = 0;
    this.recentGifts = new Map();
  }

  getWsEndpoints() {
    const token = encodeURIComponent(this.apiToken);
    return [
      `ws://127.0.0.1:62024`,
      `ws://localhost:62024`,
      `ws://127.0.0.1:62824`,
      `ws://localhost:62824`,
      `ws://127.0.0.1:62030`,
      `ws://127.0.0.1:62024?token=${token}`,
      `ws://127.0.0.1:62824?token=${token}`,
      `ws://127.0.0.1:62025`,
      `ws://127.0.0.1:62825`,
      `ws://127.0.0.1:21213`
    ];
  }

  async connect(username, customToken = '') {
    this.disconnect();

    this.username = (username || '').trim().replace(/^@/, '').toLowerCase();
    if (customToken && customToken.trim()) {
      this.apiToken = customToken.trim();
    }

    this.updateStatus('connecting', 'Menghubungkan ke IndoFinity WebSocket...');

    const wsSuccess = await this.tryWebSocketConnections();
    if (wsSuccess) return;

    this.updateStatus('disconnected', 'Gagal: IndoFinity belum merespon. Pastikan aplikasi IndoFinity terbuka.');
  }

  async tryWebSocketConnections() {
    const endpoints = this.getWsEndpoints();
    for (const wsUrl of endpoints) {
      const success = await this.initWebSocket(wsUrl);
      if (success) return true;
    }
    return false;
  }

  initWebSocket(wsUrl) {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(wsUrl);

        const timeout = setTimeout(() => {
          try { ws.close(); } catch (e) { }
          resolve(false);
        }, 1800);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.websocket = ws;
          this.isConnected = true;
          this.updateStatus('connected', `Terhubung ke IndoFinity WebSocket`);
          this.setupWsListeners(ws);
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          try { ws.close(); } catch (e) { }
          resolve(false);
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  setupWsListeners(ws) {
    ws.onmessage = (event) => {
      if (event && event.data) {
        this.parseIndoFinityPayload(event.data);
      }
    };

    ws.onclose = () => {
      if (this.isConnected) {
        this.isConnected = false;
        this.updateStatus('disconnected', 'Koneksi IndoFinity WS terputus. Mencoba reconnect...');
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (this.username) this.connect(this.username, this.apiToken);
        }, 4000);
      }
    };
  }

  parseIndoFinityPayload(rawData) {
    if (!rawData) return;
    try {
      let str = String(rawData).trim();

      // Strip Socket.IO frame packet numbers (e.g., 42["chat", {...}])
      if (/^\d+/.test(str)) {
        str = str.replace(/^\d+/, '').trim();
      }

      if (!str || (!str.startsWith('{') && !str.startsWith('['))) return;

      let dataObj = JSON.parse(str);
      if (!dataObj) return;

      // Handle Socket.IO array payload: ["chat", { ... }] or ["message", { ... }]
      if (Array.isArray(dataObj)) {
        if (typeof dataObj[0] === 'string' && dataObj[1] && typeof dataObj[1] === 'object') {
          const eventName = dataObj[0];
          const eventPayload = dataObj[1];
          this.processSingleEvent({ event: eventName, data: eventPayload });
          return;
        }
        dataObj.forEach(item => this.processSingleEvent(item));
        return;
      }

      this.processSingleEvent(dataObj);
    } catch (e) {
      console.warn('[IndoFinity] Frame parse notice:', e);
    }
  }

  processSingleEvent(message) {
    if (!message) return;

    const eventName = String(message.event || message.type || message.eventType || 'chat').toLowerCase();
    const eventData = message.data || message.payload || message.detail || message;

    // Search for nickname / uniqueId
    const nickname = eventData.nickname || eventData.displayName || eventData.uniqueId || eventData.username ||
      eventData.user?.nickname || eventData.user?.uniqueId ||
      eventData.data?.nickname || eventData.data?.uniqueId ||
      message.nickname || message.uniqueId || 'Viewer';

    const avatar = eventData.profilePictureUrl || eventData.avatar || eventData.user?.avatarMedium || 'https://www.tiktok.com/favicon.ico';

    // 1. EVENT: TIKTOK GIFT
    if (eventName.includes('gift') || eventData.giftName || eventData.giftId || eventData.extendedGiftInfo) {
      // Ignore repeat streaks in progress until combo finishes
      const isStreakInProgress = eventData.repeat_end === 0 ||
        eventData.repeat_end === false ||
        eventData.repeatEnd === false;

      if (isStreakInProgress) {
        return;
      }

      const giftName = eventData.giftName || eventData.describe || eventData.gift?.name || 'Gift';
      const count = eventData.repeatCount || eventData.count || eventData.comboCount || 1;
      const giftUniqueKey = `${nickname}_${giftName}_${count}_${eventData.msgId || eventData.groupId || eventData.id || ''}`;

      const now = Date.now();
      const lastGiftTime = this.recentGifts.get(giftUniqueKey) || 0;
      if (now - lastGiftTime < 3500) {
        return;
      }
      this.recentGifts.set(giftUniqueKey, now);
      setTimeout(() => this.recentGifts.delete(giftUniqueKey), 10000);

      if (this.onAlert) {
        this.onAlert({
          type: 'tiktok_gift',
          platform: 'tiktok',
          user: nickname,
          gift: giftName,
          count: count,
          avatar
        });
      }
      return;
    }

    // 2. EVENT: TIKTOK TAP TAP / LIKE (Tiap 100 Like)
    if (eventName.includes('like') || eventData.likeCount !== undefined || eventData.totalLikes !== undefined || eventData.totalLikeCount !== undefined) {
      const rawTotal = eventData.totalLikeCount ?? eventData.totalLikes ?? eventData.total_like_count ?? eventData.total_likes;
      if (typeof rawTotal === 'number' && !isNaN(rawTotal)) {
        this.accumulatedLikes = Math.max(this.accumulatedLikes || 0, rawTotal);
      } else if (typeof rawTotal === 'string' && /^\d+$/.test(rawTotal)) {
        this.accumulatedLikes = Math.max(this.accumulatedLikes || 0, parseInt(rawTotal, 10));
      } else {
        const parsedLikes = parseInt(eventData.likeCount, 10);
        const addedLikes = !isNaN(parsedLikes) && parsedLikes > 0 ? parsedLikes : 1;
        this.accumulatedLikes = (this.accumulatedLikes || 0) + addedLikes;
      }

      const milestoneStep = 100;
      const currentMilestone = Math.floor(this.accumulatedLikes / milestoneStep) * milestoneStep;
      const now = Date.now();

      if (currentMilestone > this.lastLikeMilestone && currentMilestone >= milestoneStep) {
        this.lastLikeMilestone = currentMilestone;

        if (now - this.lastLikeAlertTime >= 6000) {
          this.lastLikeAlertTime = now;
          if (this.onAlert) {
            this.onAlert({
              type: 'tiktok_like',
              platform: 'tiktok',
              user: nickname,
              count: currentMilestone,
              avatar
            });
          }
        }
      }
      return;
    }

    console.log('[TikTok Event]', eventName, eventData);

    // 3. EVENT: PENONTON JOIN LIVE / METRIK ROOM (Abaikan agar tidak memicu alert follow)
    if (
      eventName === 'member' ||
      eventName === 'join' ||
      eventName === 'roomuser' ||
      eventName.includes('member') ||
      eventName.includes('join') ||
      eventName.includes('room') ||
      eventName.includes('enter') ||
      eventName.includes('welcome') ||
      eventName.includes('view') ||
      eventName.includes('count') ||
      eventName.includes('stat')
    ) {
      return;
    }

    // 4. EVENT: TIKTOK FOLLOWER (Dinonaktifkan sementara karena keterbatasan stream event IndoFinity)
    // IndoFinity tidak memisahkan event follow murni secara reliabel tanpa TikFinity,
    // sehingga dinonaktifkan agar tidak ada alert yang salah muncul saat penonton berinteraksi di siaran.
    /*
    const isDirectFollow = eventName === 'follow' || eventName === 'tiktok_follow' || eventName === 'subscribe';
    const isSocialFollow = (eventName === 'social' || eventName === 'socialmessage') && (
      String(eventData.displayType || '').toLowerCase().includes('follow') ||
      String(eventData.label || '').toLowerCase().includes('follow')
    );

    if (isDirectFollow || isSocialFollow) {
      if (this.onAlert) {
        this.onAlert({
          type: 'tiktok_follow',
          platform: 'tiktok',
          user: nickname,
          avatar
        });
      }
      return;
    }
    */


    // Search for comment across all nested properties
    const comment = eventData.comment || eventData.text || eventData.message || eventData.content ||
      eventData.data?.comment || eventData.data?.text || eventData.data?.message ||
      message.comment || message.text || message.message;
    if (!comment) return;

    const uniqueId = (eventData.uniqueId || eventData.username || eventData.user?.uniqueId || nickname).toLowerCase();

    // Detect Creator / Host
    const isCreator = eventData.isHost || eventData.isCreator || eventData.isBroadcaster || message.isHost ||
      (this.username && uniqueId === this.username.toLowerCase());

    const msgId = eventData.msgId || eventData.id || message.id || `indo-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    if (this.seenMessageIds.has(msgId)) return;
    this.seenMessageIds.add(msgId);

    const chatData = {
      id: msgId,
      platform: 'tiktok',
      username: isCreator ? `${nickname} (Creator 👑)` : nickname,
      userColor: isCreator ? '#ff0050' : '#00f2fe',
      message: String(comment).trim(),
      avatar,
      badges: isCreator ? ['HOST'] : [],
      timestamp: new Date()
    };

    if (this.onMessage && chatData.message) {
      this.onMessage(chatData);
    }
  }

  disconnect() {
    this.isPolling = false;
    this.isConnected = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.websocket) {
      this.websocket.onclose = null;
      this.websocket.close();
      this.websocket = null;
    }
    this.username = '';
    this.updateStatus('disconnected', 'Terputus dari IndoFinity');
  }

  updateStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({ platform: 'tiktok', state, message });
    }
  }
}

window.TikTokConnector = TikTokConnector;
