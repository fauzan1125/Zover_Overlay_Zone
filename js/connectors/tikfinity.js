/**
 * TikFinity WebSocket Connector
 * Connects to the local TikFinity desktop app (ws://localhost:21213/)
 * to receive high-reliability TikTok follower events and live viewer counts.
 */

class TikFinityConnector {
  constructor(onAlertCallback, onViewCountCallback, onStatusCallback) {
    this.onAlert = onAlertCallback;
    this.onViewCount = onViewCountCallback;
    this.onStatus = onStatusCallback;

    this.wsUrl = 'ws://localhost:21213/';
    this.websocket = null;
    this.reconnectTimer = null;
    this.reconnectIntervalMs = 3000;
    this.shouldAutoReconnect = true;
    this.isConnected = false;
    this.recentFollowers = new Map();
    this.userLikes = new Map();
    this.milestoneStep = 100;
  }

  setMilestoneStep(step) {
    const val = parseInt(step, 10);
    if (!isNaN(val) && val > 0) {
      this.milestoneStep = val;
    }
  }

  connect() {
    this.disconnect();
    this.shouldAutoReconnect = true;
    this.updateStatus('connecting', 'Menghubungkan ke TikFinity (ws://localhost:21213)...');

    try {
      this.websocket = new WebSocket(this.wsUrl);

      this.websocket.onopen = () => {
        this.isConnected = true;
        this.clearReconnect();
        this.updateStatus('connected', 'Terhubung ke TikFinity WebSocket');
      };

      this.websocket.onclose = () => {
        this.handleDisconnect('Koneksi TikFinity terputus. Mencoba reconnect...');
      };

      this.websocket.onerror = () => {
        // Handled gracefully in onclose to prevent duplicate status spam
        if (this.websocket) {
          try { this.websocket.close(); } catch (e) {}
        }
      };

      this.websocket.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (err) {
      this.handleDisconnect('Error inisialisasi WebSocket TikFinity: ' + (err.message || 'unknown error'));
    }
  }

  disconnect() {
    this.shouldAutoReconnect = false;
    this.clearReconnect();

    if (this.websocket) {
      this.websocket.onopen = null;
      this.websocket.onclose = null;
      this.websocket.onerror = null;
      this.websocket.onmessage = null;
      try {
        this.websocket.close();
      } catch (e) {}
      this.websocket = null;
    }

    if (this.isConnected) {
      this.isConnected = false;
      this.updateStatus('disconnected', 'Terputus dari TikFinity');
    }
  }

  handleDisconnect(message) {
    if (!this.isConnected && this.reconnectTimer) return; // Prevent double logging

    this.isConnected = false;
    this.websocket = null;
    this.updateStatus('disconnected', message);

    // Guard against reconnect loops when Native TikTok mode is active
    if (window.tiktokNativeActive) {
      return;
    }

    if (this.shouldAutoReconnect && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.shouldAutoReconnect && !window.tiktokNativeActive) {
          this.connect();
        }
      }, this.reconnectIntervalMs);
    }
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  updateStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({
        platform: 'tikfinity',
        state,
        message
      });
    }
  }

  handleMessage(raw) {
    if (!raw) return;

    let packet;
    try {
      packet = JSON.parse(raw);
    } catch (e) {
      return;
    }

    const eventName = String(packet.event || '').toLowerCase();
    const data = packet.data || {};

    // 1. Follower alert
    const isFollow = eventName === 'follow' ||
      eventName === 'follower' ||
      eventName === 'new_follower' ||
      eventName === 'tiktok_follow' ||
      (eventName.includes('follow') && !eventName.includes('unfollow'));

    if (isFollow) {
      const username = data.nickname || data.uniqueId || data.username || 'Follower Baru';
      const avatar = data.profilePictureUrl || data.avatarUrl || data.avatar || '';
      const followKey = (data.uniqueId || username).toLowerCase();

      const now = Date.now();
      const lastFollow = this.recentFollowers.get(followKey) || 0;
      if (now - lastFollow < 6000) {
        return;
      }
      this.recentFollowers.set(followKey, now);
      setTimeout(() => this.recentFollowers.delete(followKey), 15000);

      if (this.onAlert) {
        this.onAlert({
          type: 'tiktok_follow',
          platform: 'tiktok',
          user: username,
          avatar
        });
      }
    }

    // 2. Viewer count metric
    const rawCount = data.viewerCount ??
      data.viewer_count ??
      data.user_count ??
      data.viewers ??
      data.roomUserCount ??
      (eventName === 'roomuser' || eventName === 'viewcount' ? data.count : undefined);

    if (rawCount !== undefined && rawCount !== null) {
      const count = parseInt(rawCount, 10);
      if (!isNaN(count) && count >= 0 && this.onViewCount) {
        this.onViewCount(count);
      }
    }

    // 3. Tap-tap like event (accumulated per user to avoid room-level aggregate spam)
    const isLike = eventName === 'like' ||
      eventName === 'tiktok_like' ||
      eventName === 'likes' ||
      (eventName.includes('like') && !eventName.includes('unlike'));

    if (isLike) {
      const username = data.nickname || data.uniqueId || data.username || 'Penonton';
      const userKey = String(data.uniqueId || username).trim().toLowerCase();
      const avatar = data.profilePictureUrl || data.avatarUrl || data.avatar || '';
      const addedLikes = parseInt(data.likeCount, 10) || 1;

      let userRecord = this.userLikes.get(userKey);
      if (!userRecord) {
        userRecord = { count: 0, lastMilestone: 0, lastAlertTime: 0, lastSeen: Date.now() };
        this.userLikes.set(userKey, userRecord);
      }

      userRecord.count += addedLikes;
      userRecord.lastSeen = Date.now();

      const step = this.milestoneStep || 100;
      const currentMilestone = Math.floor(userRecord.count / step) * step;
      const now = Date.now();

      if (currentMilestone > userRecord.lastMilestone && currentMilestone >= step) {
        userRecord.lastMilestone = currentMilestone;

        // Debounce per-user to prevent queue floods during rapid bursts
        if (now - userRecord.lastAlertTime >= 5000) {
          userRecord.lastAlertTime = now;
          if (this.onAlert) {
            this.onAlert({
              type: 'tiktok_like',
              platform: 'tiktok',
              user: username,
              count: currentMilestone,
              avatar
            });
          }
        }
      }

      // Bound cache size for long streams
      if (this.userLikes.size > 1000) {
        const staleLimit = now - (30 * 60 * 1000);
        for (const [key, record] of this.userLikes.entries()) {
          if (record.lastSeen < staleLimit) {
            this.userLikes.delete(key);
          }
        }
      }
    }
  }
}

window.TikFinityConnector = TikFinityConnector;
