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

    if (this.shouldAutoReconnect && !this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.shouldAutoReconnect) {
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
  }
}

window.TikFinityConnector = TikFinityConnector;
