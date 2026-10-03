/**
 * Kick Live Chat Connector (Resilient & Keep-Alive Edition)
 * Connects directly to Kick's Pusher WebSocket server using channel usernames.
 */

class KickConnector {
  constructor(onMessageCallback, onStatusCallback, onAlertCallback) {
    this.onMessage = onMessageCallback;
    this.onStatus = onStatusCallback;
    this.onAlert = onAlertCallback;
    this.websocket = null;
    this.username = '';
    this.chatroomId = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.pingInterval = null;

    // Kick Pusher App Key & Cluster (Active Key)
    this.pusherAppKey = '32cbd69e4b950bf97679';
    this.pusherCluster = 'us2';
  }

  async connect(username) {
    if (!username) return;
    this.disconnect();

    this.username = username.trim().toLowerCase();
    this.updateStatus('connecting', `Mencari channel Kick: ${this.username}...`);

    try {
      // Step 1: Resolve Chatroom ID
      const chatroomId = await this.fetchChatroomId(this.username);
      if (!chatroomId) {
        throw new Error(`Chatroom ID untuk Kick "${this.username}" tidak ditemukan.`);
      }

      this.chatroomId = chatroomId;
      this.initWebSocket();
    } catch (err) {
      console.error('[Kick Connector Error]', err);
      this.updateStatus('disconnected', `Gagal: ${err.message}`);
    }
  }

  async fetchChatroomId(username) {
    const cleanUser = username.toLowerCase();

    const t = Date.now();
    const kickApiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(cleanUser)}`;
    const kickChannelUrl = `https://kick.com/${encodeURIComponent(cleanUser)}`;

    // Strategy 1: Local server proxy (fastest and most reliable)
    try {
      const localProxyUrl = `http://localhost:8765/proxy?url=${encodeURIComponent(kickApiUrl + '?_t=' + t)}`;
      const res = await fetch(localProxyUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
      if (res.ok) {
        const text = await res.text();
        const data = JSON.parse(text);
        const id = data.chatroom?.id || data.id;
        if (id) return parseInt(id);
      }
    } catch (e) {}

    // Strategy 2: Direct fetch to Kick API
    try {
      const res = await fetch(kickApiUrl);
      if (res.ok) {
        const data = await res.json();
        const id = data.chatroom?.id || data.id;
        if (id) return parseInt(id);
      }
    } catch (e) {}

    // Strategy 3: Fetch Channel HTML via codetabs proxy
    try {
      const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(kickChannelUrl + '?_t=' + t)}`;
      const res = await fetch(proxyUrl);
      const html = await res.text();
      const match = html.match(/"chatroom"\s*:\s*\{\s*"id"\s*:\s*(\d+)/) || html.match(/"chatroom_id"\s*:\s*(\d+)/);
      if (match && match[1]) return parseInt(match[1]);
    } catch (e) {}

    // Strategy 4: Fetch Kick Channel API via allorigins proxy
    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(kickApiUrl + '?_t=' + t)}`;
      const res = await fetch(proxyUrl);
      const json = await res.json();
      if (json.contents) {
        const data = JSON.parse(json.contents);
        const id = data.chatroom?.id || data.id;
        if (id) return parseInt(id);
      }
    } catch (e) {}

    return null;
  }

  initWebSocket() {
    const wsUrl = `wss://ws-${this.pusherCluster}.pusher.com/app/${this.pusherAppKey}?protocol=7&client=js&version=7.4.0&flash=false`;
    
    try {
      this.websocket = new WebSocket(wsUrl);

      this.websocket.onopen = () => {
        this.isConnected = true;
        this.updateStatus('connected', `Terhubung ke Kick: ${this.username}`);

        // Subscribe to Kick chatroom Pusher channel
        const subscribePayload = {
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `chatrooms.${this.chatroomId}.v2`
          }
        };
        this.websocket.send(JSON.stringify(subscribePayload));

        // Start 25s ping keep-alive interval to prevent disconnection
        this.pingInterval = setInterval(() => {
          if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          }
        }, 25000);
      };

      this.websocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handlePusherEvent(msg);
        } catch (e) {}
      };

      this.websocket.onerror = (err) => {
        console.error('[Kick WS Error]', err);
      };

      this.websocket.onclose = () => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.cleanup();

        if (wasConnected) {
          this.updateStatus('disconnected', 'Koneksi Kick terputus. Mencoba reconnect...');
          this.reconnectTimer = setTimeout(() => {
            if (this.username) this.connect(this.username);
          }, 5000);
        }
      };
    } catch (err) {
      this.updateStatus('disconnected', `Gagal koneksi Kick: ${err.message}`);
    }
  }

  handlePusherEvent(msg) {
    if (!msg || !msg.event) return;

    // EVENT: KICK SUBSCRIPTION / GIFTED SUBS
    if (msg.event === 'App\\Events\\SubscriptionEvent' || msg.event === 'App\\Events\\GiftedSubscriptionsEvent' || msg.event.includes('Subscription')) {
      try {
        const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        const subUser = data.username || data.sender?.username || data.gifter_username || data.user?.username || 'KickUser';
        if (this.onAlert) {
          this.onAlert({
            type: 'kick_sub',
            platform: 'kick',
            user: subUser
          });
        }
      } catch (e) {}
      return;
    }

    if (msg.event === 'App\\Events\\ChatMessageEvent') {
      const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
      
      const chatData = {
        id: data.id || 'kick-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        platform: 'kick',
        username: data.sender?.username || 'KickUser',
        userColor: data.sender?.identity?.color || '#53FC18',
        message: data.content || '',
        avatar: data.sender?.profile_pic || 'https://kick.com/favicon.ico',
        badges: data.sender?.identity?.badges || [],
        timestamp: new Date()
      };

      if (this.onMessage && chatData.message) {
        this.onMessage(chatData);
      }
    }
  }

  disconnect() {
    this.cleanup();
    this.isConnected = false;
    this.username = '';
    this.chatroomId = null;
    this.updateStatus('disconnected', 'Terputus dari Kick');
  }

  cleanup() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.websocket) {
      this.websocket.onclose = null;
      this.websocket.close();
      this.websocket = null;
    }
  }

  updateStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({ platform: 'kick', state, message });
    }
  }
}

window.KickConnector = KickConnector;
