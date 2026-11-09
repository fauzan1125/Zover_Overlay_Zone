class TikTokConnector {
  constructor(onMessageCallback, onStatusCallback, onAlertCallback, onViewCountCallback) {
    this.onMessage = onMessageCallback;
    this.onStatus = onStatusCallback;
    this.onAlert = onAlertCallback;
    this.onViewCount = onViewCountCallback || ((count) => {
      if (window.app && window.app.viewcount) {
        window.app.viewcount.setTikTokCount(count);
      }
    });

    this.username = '';
    this.apiToken = '';
    this.isConnected = false;
    this.websocket = null;
    this.reconnectTimer = null;
    this.isDirectNative = true;

    this.seenMessageIds = new Set();
    this.accumulatedLikes = 0;
    this.lastLikeMilestone = 0;
    this.lastLikeAlertTime = 0;
    this.milestoneStep = 100;
    this.recentGifts = new Map();
    this.recentFollowers = new Map();
    this.seenFollowers = new Set();
  }

  setMilestoneStep(step) {
    const val = parseInt(step, 10);
    if (!isNaN(val) && val > 0) {
      this.milestoneStep = val;
    }
  }

  async connect(username, customToken = '') {
    this.disconnect();

    this.username = (username || '').trim().replace(/^@/, '').toLowerCase();
    if (customToken && customToken.trim()) {
      this.apiToken = customToken.trim();
    } else {
      this.apiToken = '';
    }

    if (!this.username) {
      this.updateStatus('disconnected', 'Username TikTok belum diisi');
      return;
    }

    window.tiktokNativeActive = true;
    this.updateStatus('connecting', `Menghubungkan ke TikTok Live (@${this.username})...`);

    const directSuccess = await this.connectNativeWebSocket();
    if (directSuccess) return;

    this.updateStatus('connecting', 'Mencoba menyambung via IndoFinity...');
    const indoSuccess = await this.connectIndoFinityFallback();
    if (indoSuccess) return;

    if (this.apiToken) {
      this.updateStatus('disconnected', 'Gagal: Pastikan aplikasi IndoFinity sudah dibuka');
    } else {
      this.updateStatus('disconnected', 'TikTok: Mode Langsung butuh EulerStream Key, atau silakan buka IndoFinity');
    }
  }

  connectNativeWebSocket() {
    return new Promise((resolve) => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:8765';
        const tokenQuery = this.apiToken ? `&sessionId=${encodeURIComponent(this.apiToken)}` : '';
        const wsUrl = `${protocol}//${host}/ws/tiktok?username=${encodeURIComponent(this.username)}${tokenQuery}`;

        const ws = new WebSocket(wsUrl);
        let settled = false;

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch (_) {}
            resolve(false);
          }
        }, 6000);

        ws.onopen = () => {
          this.websocket = ws;
        };

        ws.onmessage = (event) => {
          if (!event || !event.data) return;
          try {
            const payload = JSON.parse(event.data);

            if (!settled) {
              if (payload.type === 'status' && payload.status === 'connected') {
                settled = true;
                clearTimeout(timeout);
                this.isConnected = true;
                this.isDirectNative = true;
                this.updateStatus('connected', `Terhubung (@${this.username})`);
                this.setupNativeListeners(ws);
                resolve(true);
                return;
              } else if (payload.type === 'error') {
                settled = true;
                clearTimeout(timeout);
                try { ws.close(); } catch (_) {}
                resolve(false);
                return;
              }
            }

            this.handleNativePayload(payload);
          } catch (err) {
            console.warn('[TikTok Native WS] Invalid frame:', err);
          }
        };

        ws.onerror = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(false);
          }
        };

        ws.onclose = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve(false);
          } else if (this.isConnected) {
            this.isConnected = false;
            this.updateStatus('disconnected', 'Koneksi TikTok terputus. Mencoba reconnect...');
            if (typeof this.onViewCount === 'function') {
              this.onViewCount(0);
            }
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        resolve(false);
      }
    });
  }

  setupNativeListeners(ws) {
    ws.onmessage = (event) => {
      if (!event || !event.data) return;
      try {
        const payload = JSON.parse(event.data);
        this.handleNativePayload(payload);
      } catch (err) {
        console.warn('[TikTok Native WS] Invalid frame:', err);
      }
    };
  }

  handleNativePayload(payload) {
    if (!payload || !payload.type) return;

    switch (payload.type) {
      case 'status':
        if (payload.status === 'connected') {
          this.updateStatus('connected', `Terhubung (@${this.username})`);
        } else if (payload.status === 'disconnected') {
          this.updateStatus('disconnected', 'TikTok Live stream berakhir atau terputus');
          if (typeof this.onViewCount === 'function') {
            this.onViewCount(0);
          }
        }
        break;

      case 'error':
        this.updateStatus('error', payload.message || 'TikTok Live Error');
        break;

      case 'chat':
        this.processChatEvent(payload.data);
        break;

      case 'gift':
        this.processGiftEvent(payload.data);
        break;

      case 'like':
        this.processLikeEvent(payload.data);
        break;

      case 'follow':
        this.processFollowEvent(payload.data);
        break;

      case 'viewers':
        this.processViewerCountEvent(payload.data);
        break;
    }
  }

  processChatEvent(data) {
    if (!data || !data.comment) return;

    const msgId = data.msgId || `tt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (this.seenMessageIds.has(msgId)) return;
    this.seenMessageIds.add(msgId);
    if (this.seenMessageIds.size > 500) {
      const first = this.seenMessageIds.values().next().value;
      this.seenMessageIds.delete(first);
    }

    const uniqueId = String(data.uniqueId || '').toLowerCase();
    const isCreator = this.username && uniqueId === this.username.toLowerCase();
    const displayName = data.nickname || data.uniqueId || 'Penonton';

    const chatPayload = {
      id: msgId,
      platform: 'tiktok',
      username: isCreator ? `${displayName} (Creator 👑)` : displayName,
      userColor: isCreator ? '#ff0050' : '#00f2fe',
      message: String(data.comment).trim(),
      avatar: data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico',
      badges: isCreator ? ['HOST'] : [],
      timestamp: new Date(data.createTime ? Number(data.createTime) : Date.now())
    };

    if (this.onMessage && chatPayload.message) {
      this.onMessage(chatPayload);
    }
  }

  processGiftEvent(data) {
    if (!data) return;

    // Gift streak handling: combo gifts emit every tap until streak finishes
    const isCombo = data.giftType === 1;
    if (isCombo && data.repeatEnd === false) {
      return;
    }

    const user = data.nickname || data.uniqueId || 'Penonton';
    const giftName = data.giftName || 'Gift';
    const count = Number(data.repeatCount) || 1;
    const coins = (Number(data.diamondCount) || 0) * count;
    const avatar = data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico';
    const giftIcon = data.giftPictureUrl || '';

    const giftKey = `${user}_${giftName}_${count}_${data.giftId || ''}`;
    const now = Date.now();
    const lastTime = this.recentGifts.get(giftKey) || 0;
    if (now - lastTime < 3000) return;
    this.recentGifts.set(giftKey, now);
    setTimeout(() => this.recentGifts.delete(giftKey), 10000);

    if (this.onAlert) {
      this.onAlert({
        type: 'tiktok_gift',
        platform: 'tiktok',
        user,
        gift: giftName,
        count,
        coins,
        avatar,
        giftIcon
      });
    }
  }

  processLikeEvent(data) {
    if (!data) return;

    const addedLikes = Number(data.likeCount) || 1;
    this.accumulatedLikes += addedLikes;

    const step = this.milestoneStep || 100;
    const currentMilestone = Math.floor(this.accumulatedLikes / step) * step;
    const now = Date.now();

    if (currentMilestone > this.lastLikeMilestone && currentMilestone >= step) {
      this.lastLikeMilestone = currentMilestone;

      if (now - this.lastLikeAlertTime >= 4000) {
        this.lastLikeAlertTime = now;
        const user = data.nickname || data.uniqueId || 'Penonton TikTok';

        if (this.onAlert) {
          this.onAlert({
            type: 'tiktok_like',
            platform: 'tiktok',
            user,
            count: currentMilestone,
            avatar: 'https://www.tiktok.com/favicon.ico'
          });
        }
      }
    }
  }

  processFollowEvent(data) {
    if (!data) return;

    const uniqueId = String(data.uniqueId || '').trim();
    const user = data.nickname || data.uniqueId || 'Follower Baru';
    const followKey = (uniqueId || user).toLowerCase();

    if (this.seenFollowers.has(followKey)) return;
    this.seenFollowers.add(followKey);

    const avatar = data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico';

    if (this.onAlert) {
      this.onAlert({
        type: 'tiktok_follow',
        platform: 'tiktok',
        user,
        avatar
      });
    }
  }

  processViewerCountEvent(data) {
    if (!data || data.viewerCount === undefined) return;
    const count = parseInt(data.viewerCount, 10);
    if (!isNaN(count) && count >= 0 && typeof this.onViewCount === 'function') {
      this.onViewCount(count);
    }
  }

  async connectIndoFinityFallback() {
    const token = encodeURIComponent(this.apiToken || '');
    const endpoints = [
      `ws://127.0.0.1:62024?token=${token}`,
      `ws://127.0.0.1:62824?token=${token}`,
      'ws://127.0.0.1:62024',
      'ws://localhost:62024',
      'ws://127.0.0.1:62824',
      'ws://localhost:62824',
      'ws://127.0.0.1:62030'
    ];

    for (const wsUrl of endpoints) {
      const success = await new Promise(resolve => {
        try {
          const ws = new WebSocket(wsUrl);
          const timeout = setTimeout(() => {
            try { ws.close(); } catch (_) {}
            resolve(false);
          }, 1500);

          ws.onopen = () => {
            clearTimeout(timeout);
            this.websocket = ws;
            this.isConnected = true;
            this.isDirectNative = false;
            this.updateStatus('connected', 'Terhubung ke IndoFinity WebSocket');
            ws.onmessage = e => this.parseIndoFinityPayload(e.data);
            ws.onclose = () => {
              if (this.isConnected) {
                this.isConnected = false;
                this.updateStatus('disconnected', 'Koneksi IndoFinity terputus');
              }
            };
            resolve(true);
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            try { ws.close(); } catch (_) {}
            resolve(false);
          };
        } catch (_) {
          resolve(false);
        }
      });

      if (success) return true;
    }

    return false;
  }

  parseIndoFinityPayload(rawData) {
    if (!rawData) return;
    try {
      let str = String(rawData).trim();
      if (/^\d+/.test(str)) {
        str = str.replace(/^\d+/, '').trim();
      }
      if (!str || (!str.startsWith('{') && !str.startsWith('['))) return;

      const dataObj = JSON.parse(str);
      if (Array.isArray(dataObj)) {
        if (typeof dataObj[0] === 'string' && dataObj[1] && typeof dataObj[1] === 'object') {
          this.handleIndoFinityItem(dataObj[0], dataObj[1]);
          return;
        }
        dataObj.forEach(item => this.handleIndoFinityItem(item.event || item.type, item.data || item));
        return;
      }

      this.handleIndoFinityItem(dataObj.event || dataObj.type, dataObj.data || dataObj);
    } catch (_) {}
  }

  handleIndoFinityItem(eventName, data) {
    if (!data) return;
    const name = String(eventName || '').toLowerCase();

    if (name.includes('chat') || data.comment || data.message) {
      this.processChatEvent({
        msgId: data.msgId || data.id,
        uniqueId: data.uniqueId || data.username,
        nickname: data.nickname || data.displayName,
        comment: data.comment || data.message || data.text,
        profilePictureUrl: data.profilePictureUrl || data.avatar,
        createTime: data.createTime
      });
    } else if (name.includes('gift') || data.giftName) {
      this.processGiftEvent({
        giftId: data.giftId,
        giftName: data.giftName || data.name,
        repeatCount: data.repeatCount || data.count || 1,
        repeatEnd: data.repeatEnd !== false,
        giftType: data.giftType || 0,
        diamondCount: data.diamondCount || 0,
        uniqueId: data.uniqueId || data.username,
        nickname: data.nickname || data.displayName,
        profilePictureUrl: data.profilePictureUrl || data.avatar,
        giftPictureUrl: data.giftPictureUrl || data.giftIcon
      });
    } else if (name.includes('follow')) {
      this.processFollowEvent(data);
    } else if (name.includes('roomuser') || name.includes('viewers') || name.includes('viewcount')) {
      const v = data.viewerCount ?? data.count ?? data.userCount;
      if (v !== undefined) {
        this.processViewerCountEvent({ viewerCount: v });
      }
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.username) {
        this.connect(this.username, this.apiToken);
      }
    }, 4000);
  }

  disconnect() {
    this.isConnected = false;
    window.tiktokNativeActive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.websocket) {
      this.websocket.onclose = null;
      this.websocket.onerror = null;
      this.websocket.onmessage = null;
      try {
        this.websocket.close();
      } catch (_) {}
      this.websocket = null;
    }
    if (typeof this.onViewCount === 'function') {
      this.onViewCount(0);
    }
    this.seenFollowers.clear();
    this.updateStatus('disconnected', 'Terputus');
  }

  updateStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({ platform: 'tiktok', state, message });
    }
  }
}

window.TikTokConnector = TikTokConnector;
