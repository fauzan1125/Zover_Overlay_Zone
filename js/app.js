/**
 * Main Application Controller (LocalStorage & BroadcastChannel Dual Sync Edition)
 * Handles application state, UI bindings, and 100% reliable cross-window OBS Studio synchronization.
 */

function initApp() {
  if (window.app) return;
  const urlParams = new URLSearchParams(window.location.search);
  const isOverlayMode = urlParams.get('mode') === 'overlay' || window.location.pathname.toLowerCase().endsWith('overlay_chat.html');

  if (isOverlayMode) {
    document.body.classList.add('mode-overlay');
  }

  // Initialize Application Instance
  window.app = new Application(isOverlayMode);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

class Application {
  constructor(isOverlayMode) {
    this.isOverlayMode = isOverlayMode;
    this.storageKey = 'chat_overlay_mbak_google_config';
    this.triggerKey = 'chat_overlay_mbak_google_trigger';
    this.liveChatKey = 'chat_overlay_mbak_google_live_chat';
    this.seenMessageIds = new Set();

    // Default Configuration State
    this.config = {
      kickUsername: '',
      ytVideoInput: '',
      ytApiKey: '',
      tiktokUsername: '',
      tiktokApiToken: '',

      // TTS Settings
      ttsEnabled: true,
      ttsVolume: 1.0,
      ttsRate: 1.0,
      ttsPitch: 1.0,
      ttsGender: 'female',
      ttsTemplate: '{user} berkata {message}',
      ttsIgnoredPrefixes: '!, /, ., $',
      ttsBlacklist: 'kasar, toxic, badword',
      ttsPlatforms: {
        kick: true,
        youtube: true,
        tiktok: true
      },

      // Overlay Theme & Style
      overlayTheme: 'theme-gamer-neon',
      overlayFontSize: 16,
      overlayAnimation: 'anim-slide-left',
      overlayMaxMessages: 15,
      overlayHideDuration: 15,
      overlayShowBadges: true,
      overlayShowAvatars: true,
      viewCountEnabled: true,
      viewCountPlatforms: { kick: true, youtube: true, tiktok: true },
      viewCountRefresh: 30,

      // Alert & Soundboard Overlay Settings
      alertDuration: 6,
      alertSoundVolume: 0.8,
      alerts: {
        yt_sub: {
          enabled: true,
          title: 'TERIMA KASIH {user} SUDAH SUBS',
          subtext: 'YouTube Subscription',
          videoUrl: '',
          soundUrl: 'media/alerts/default_alert.mp3'
        },
        kick_sub: {
          enabled: true,
          title: 'TERIMA KASIH {user} SUDAH SUBS',
          subtext: 'Kick Subscription',
          videoUrl: '',
          soundUrl: 'media/alerts/default_alert.mp3'
        },
        tiktok_follow: {
          enabled: true,
          title: 'TERIMA KASIH {user} SUDAH FOLLOW',
          subtext: 'TikTok New Follower',
          videoUrl: '',
          soundUrl: 'media/alerts/default_alert.mp3'
        },
        tiktok_gift: {
          enabled: true,
          title: 'TERIMA KASIH {user} SUDAH GIFT {gift} x{count}',
          subtext: 'TikTok Live Gift',
          videoUrl: '',
          soundUrl: 'media/alerts/default_alert.mp3'
        },
        tiktok_like: {
          enabled: true,
          title: 'TERIMA KASIH SEMUANYA! {count} TAP TAP LIKE TERCAPAI',
          subtext: 'TikTok Tap-Tap Like Milestone',
          videoUrl: '',
          soundUrl: 'media/alerts/default_alert.mp3',
          milestoneStep: 100
        }
      }
    };

    // Alert Broadcast Channel & Storage Key
    try {
      this.alertBroadcastChannel = new BroadcastChannel('zover_alert_channel');
    } catch (e) {}
    this.alertTriggerKey = 'chat_overlay_alert_trigger';

    // Initialize Services
    this.tts = new MbakGoogleTTS();

    // Initialize Connectors
    const onChatMessage = (chatData) => this.handleIncomingChat(chatData, false);
    const onStatusUpdate = (status) => this.handleStatusUpdate(status);
    const onAlert = (alertData) => this.handleIncomingAlert(alertData, false);
    const onViewCount = (count) => {
      if (this.viewcount) {
        this.viewcount.setTikTokCount(count);
      }
    };

    this.kick = new KickConnector(onChatMessage, onStatusUpdate, onAlert);
    this.youtube = new YouTubeConnector(onChatMessage, onStatusUpdate, onAlert);
    this.tiktok = new TikTokConnector(onChatMessage, onStatusUpdate, onAlert);
    if (typeof TikFinityConnector !== 'undefined') {
      this.tikfinity = new TikFinityConnector(onAlert, onViewCount, onStatusUpdate);
    }

    if (this.isOverlayMode) {
      document.getElementById('dashboard-app')?.remove();
    } else {
      document.getElementById('obs-overlay-view')?.remove();
    }

    // Initialize Overlay Renderer
    const containerId = this.isOverlayMode ? 'chat-stream-list-obs' : 'chat-stream-list';
    const container = document.getElementById(containerId);
    this.renderer = new OverlayRenderer(container);
    // ViewCount hanya hidup bila halaman punya bar (preview dashboard);
    // overlay_chat.html tidak memuat viewcount.js sehingga dilewati.
    if (document.getElementById('viewcount-bar') && typeof ViewCountMonitor !== 'undefined') {
      this.viewcount = new ViewCountMonitor();
    }

    this.bindDashboardEvents(); // Bind events after services are ready
    this.applyRendererConfig();

    // Setup Cross-Window LocalStorage & BroadcastChannel Sync
    this.setupCrossWindowSync();

    this.loadState().then(() => {
      this.applyTTSSettings();
      this.applyRendererConfig();

      if (!this.isOverlayMode) {
        this.updateUIFromConfig();
      } else {
        // If in OBS Overlay mode, poll the backend config every 5 seconds to sync settings live
        setInterval(() => this.pollOverlayConfig(), 5000);
      }

      this.autoConnectOverlay();
    });
  }

  async pollOverlayConfig() {
    try {
      const res = await fetch('http://localhost:8765/api/config', { cache: 'no-store' });
      if (res.ok) {
        const newConfig = await res.json();
        
        // Detect critical changes to reconnect connectors
        const kickChanged = newConfig.kickUsername !== this.config.kickUsername;
        const ytChanged = newConfig.ytVideoInput !== this.config.ytVideoInput;
        const tiktokChanged = newConfig.tiktokUsername !== this.config.tiktokUsername;

        this.config = { ...this.config, ...newConfig };
        
        // Apply aesthetic & TTS changes immediately
        this.applyTTSSettings();
        this.applyRendererConfig();

        // Reconnect or disconnect if credentials changed
        if (kickChanged) {
          if (this.config.kickUsername) this.kick.connect(this.config.kickUsername);
          else this.kick.disconnect();
        }
        if (ytChanged) {
          if (this.config.ytVideoInput) this.youtube.connect(this.config.ytVideoInput, this.config.ytApiKey);
          else this.youtube.disconnect();
        }
        if (tiktokChanged) {
          if (this.config.tiktokUsername) {
            this.tiktok.connect(this.config.tiktokUsername, this.config.tiktokApiToken);
            if (this.tikfinity) this.tikfinity.connect();
          } else {
            this.tiktok.disconnect();
            if (this.tikfinity) this.tikfinity.disconnect();
          }
        }
      }
    } catch (e) {}
  }

  applyTTSSettings() {
    if (!this.tts || typeof this.tts.updateConfig !== 'function') return;
    this.tts.updateConfig({
      enabled: this.config.ttsEnabled,
      volume: this.config.ttsVolume,
      rate: this.config.ttsRate,
      pitch: this.config.ttsPitch,
      gender: 'female', // kontrol jenis suara dihapus; suara dikunci ke perempuan
      template: this.config.ttsTemplate,
      ignoredPrefixes: this.config.ttsIgnoredPrefixes,
      blacklistedWords: this.config.ttsBlacklist,
      platforms: this.config.ttsPlatforms
    });
  }

  applyRendererConfig() {
    if (this.renderer && typeof this.renderer.updateConfig === 'function') {
      this.renderer.updateConfig({
        theme: this.config.overlayTheme,
        fontSize: this.config.overlayFontSize,
        animation: this.config.overlayAnimation,
        maxMessages: this.config.overlayMaxMessages,
        hideDuration: this.config.overlayHideDuration,
        showBadges: this.config.overlayShowBadges,
        showAvatars: this.config.overlayShowAvatars
      });
    }
    this.applyViewCountConfig();
  }

  // Teruskan pengaturan viewcount + sumber data ke ViewCountMonitor
  applyViewCountConfig() {
    if (!this.viewcount) return;
    this.viewcount.updateConfig({
      enabled: this.config.viewCountEnabled,
      platforms: this.config.viewCountPlatforms,
      refreshMs: (parseInt(this.config.viewCountRefresh, 10) || 30) * 1000,
      kickUsername: this.config.kickUsername,
      ytVideoInput: this.config.ytVideoInput,
      tiktokUsername: this.config.tiktokUsername
    });
  }

  handleIncomingChat(chatData, isFromSync = false) {
    if (!chatData || !chatData.message) return;

    const msgId = chatData.id || `${chatData.platform}-${Date.now()}-${Math.random()}`;
    if (this.seenMessageIds.has(msgId)) return;
    this.seenMessageIds.add(msgId);

    this.logActivity(`${chatData.platform} • ${chatData.username}: ${chatData.message}`, 'chat');

    if (this.seenMessageIds.size > 1000) {
      this.seenMessageIds = new Set(Array.from(this.seenMessageIds).slice(-400));
    }

    // 1. Render Chat Card in Overlay
    if (this.renderer) {
      this.renderer.addMessage(chatData);
    }

    // 2. Read Comment with Mbak Google TTS
    if (this.tts) {
      this.tts.speakMessage(chatData);
    }

    // 3. Broadcast to other open windows if originated locally
    if (!isFromSync) {
      this.broadcastLiveChat(chatData);
    }
  }

  handleIncomingAlert(alertData, isFromSync = false) {
    if (!alertData) return;
    const pName = (alertData.platform || 'ALERT').toUpperCase();
    const uName = alertData.user || 'Viewer';
    const aType = alertData.type || 'alert';

    let logDesc = `${pName} ALERT • ${uName}`;
    if (aType === 'tiktok_gift') logDesc += ` kirim Gift ${alertData.gift || ''} x${alertData.count || 1}`;
    else if (aType === 'tiktok_like') logDesc += ` Milestone ${alertData.count || 100} Likes tercapai!`;
    else if (aType === 'tiktok_follow') logDesc += ` Mulai Mengikuti (Follow)`;
    else if (aType.includes('sub')) logDesc += ` Telah Berlangganan (Subs)!`;

    this.logActivity(logDesc, 'ok');

    if (!isFromSync) {
      this.broadcastAlert(alertData);
    }
  }

  broadcastAlert(alertData) {
    const alertId = alertData.id || `alt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const normalizedData = { ...alertData, id: alertId };
    const payload = {
      type: 'ALERT_TRIGGER',
      id: alertId,
      data: normalizedData,
      timestamp: Date.now()
    };

    // 1. BroadcastChannel API
    try {
      if (this.alertBroadcastChannel) {
        this.alertBroadcastChannel.postMessage(payload);
      }
    } catch (e) {}

    // 2. LocalStorage StorageEvent
    try {
      localStorage.setItem(this.alertTriggerKey, JSON.stringify(payload));
    } catch (e) {}
  }

  triggerTestAlert(alertType) {
    const samples = {
      yt_sub: {
        type: 'yt_sub',
        platform: 'youtube',
        user: 'Budi_GamingYT'
      },
      kick_sub: {
        type: 'kick_sub',
        platform: 'kick',
        user: 'SultanKick99'
      },
      tiktok_follow: {
        type: 'tiktok_follow',
        platform: 'tiktok',
        user: 'Siti_TikToker'
      },
      tiktok_gift: {
        type: 'tiktok_gift',
        platform: 'tiktok',
        user: 'Rian_Ganteng',
        gift: 'Mawar Cantik',
        count: 5
      },
      tiktok_like: {
        type: 'tiktok_like',
        platform: 'tiktok',
        user: 'PenontonSetia',
        count: 100
      }
    };

    const data = samples[alertType] || samples.yt_sub;
    this.handleIncomingAlert(data, false);
  }

  async uploadMediaFile(file, alertKey, mediaType, statusElementId) {
    const statusEl = document.getElementById(statusElementId);
    if (!file) return;

    if (!this._uploadingFlags) this._uploadingFlags = {};
    if (this._uploadingFlags[statusElementId]) return;
    this._uploadingFlags[statusElementId] = true;

    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:#00f2fe"><i class="bi bi-hourglass-split"></i> Mengunggah ${file.name} (${sizeMb} MB)...</span>`;
    }

    try {
      // 1. Direct Binary Streaming Upload (Instan, selesai dalam hitungan milidetik)
      const uploadUrl = `http://localhost:8765/api/upload?filename=${encodeURIComponent(file.name)}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const resJson = await res.json();
      const uploadedUrl = resJson.url;

      if (!this.config.alerts[alertKey]) this.config.alerts[alertKey] = {};
      if (mediaType === 'video') {
        this.config.alerts[alertKey].videoUrl = uploadedUrl;
        const urlInput = document.getElementById(`url-video-${alertKey}`);
        if (urlInput) urlInput.value = uploadedUrl;
      } else {
        this.config.alerts[alertKey].soundUrl = uploadedUrl;
        const urlInput = document.getElementById(`url-sound-${alertKey}`);
        if (urlInput) urlInput.value = uploadedUrl;
      }

      this.notifyConfigChange();

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#10b981; font-weight:700;"><i class="bi bi-check-circle-fill"></i> Berhasil disimpan: ${uploadedUrl}</span>`;
      }
    } catch (err) {
      console.warn('[Upload Error]', err);
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#ff3333"><i class="bi bi-exclamation-triangle-fill"></i> Gagal mengunggah: ${err.message}. Pastikan server.ps1 berjalan.</span>`;
      }
    } finally {
      this._uploadingFlags[statusElementId] = false;
    }
  }

  broadcastLiveChat(chatData) {
    const payload = {
      type: 'LIVE_CHAT',
      data: chatData,
      timestamp: Date.now()
    };

    // 1. LocalStorage Trigger
    try {
      localStorage.setItem(this.liveChatKey, JSON.stringify(payload));
    } catch (e) {}

    // 2. BroadcastChannel API
    try {
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage(payload);
      }
    } catch (e) {}
  }

  handleStatusUpdate(status) {
    const { platform, state, message } = status;
    this.logActivity(`[${platform}] ${message || state}`, state === 'connected' ? 'ok' : (state === 'disconnected' ? 'err' : 'warn'));

    if (this.isOverlayMode) return;

    const dot = document.getElementById(`dot-${platform}`);
    const text = document.getElementById(`status-text-${platform}`);

    if (dot) {
      dot.className = `status-dot ${state === 'connected' ? 'active' : ''}`;
    }
    if (text) {
      text.innerText = message || state;
    }
  }

  // Tulis baris ke Card Log/Konsol (index.html). Aman di overlay: elemen tidak ada -> skip.
  logActivity(message, type = 'info') {
    const el = document.getElementById('activity-log');
    if (!el) return;
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    const t = new Date().toLocaleTimeString('id-ID');
    line.textContent = `[${t}] ${message}`;
    el.appendChild(line);
    while (el.children.length > 120) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  autoConnectOverlay() {
    if (this.config.kickUsername) this.kick.connect(this.config.kickUsername);
    if (this.config.ytVideoInput) this.youtube.connect(this.config.ytVideoInput, this.config.ytApiKey);
    if (this.config.tiktokUsername) {
      this.tiktok.connect(this.config.tiktokUsername, this.config.tiktokApiToken);
      if (this.tikfinity) this.tikfinity.connect();
    }
  }

  setupCrossWindowSync() {
    // 1. BroadcastChannel Listener
    try {
      if ('BroadcastChannel' in window) {
        this.broadcastChannel = new BroadcastChannel('chat_overlay_channel');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'LIVE_CHAT') {
            this.handleIncomingChat(event.data.data, true);
          } else if (event.data && event.data.type === 'TEST_TTS') {
            this.tts.testVoice();
          }
        };
      }
      if ('BroadcastChannel' in window) {
        if (!this.alertBroadcastChannel) this.alertBroadcastChannel = new BroadcastChannel('zover_alert_channel');
        this.alertBroadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'ALERT_TRIGGER') {
            this.handleIncomingAlert(event.data.data, true);
          }
        };
      }
    } catch (e) {}

    // 2. LocalStorage Storage Event Listener
    window.addEventListener('storage', (e) => {
      // Sync Alert Triggers
      if (e.key === this.alertTriggerKey && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload.type === 'ALERT_TRIGGER') {
            this.handleIncomingAlert(payload.data, true);
          }
        } catch (err) {}
      }

      // Sync Configuration Changes (Themes, Usernames, Volume, etc.)
      if (e.key === this.storageKey && e.newValue) {
        try {
          const newConfig = JSON.parse(e.newValue);
          const kickChanged = newConfig.kickUsername !== this.config.kickUsername;
          const ytChanged = newConfig.ytVideoInput !== this.config.ytVideoInput;
          const tiktokChanged = newConfig.tiktokUsername !== this.config.tiktokUsername;

          this.config = { ...this.config, ...newConfig };
          this.applyTTSSettings();
          this.applyRendererConfig();

          if (kickChanged) {
            if (this.config.kickUsername) this.kick.connect(this.config.kickUsername);
            else this.kick.disconnect();
          }
          if (ytChanged) {
            if (this.config.ytVideoInput) this.youtube.connect(this.config.ytVideoInput, this.config.ytApiKey);
            else this.youtube.disconnect();
          }
          if (tiktokChanged) {
            if (this.config.tiktokUsername) {
              this.tiktok.connect(this.config.tiktokUsername, this.config.tiktokApiToken);
              if (this.tikfinity) this.tikfinity.connect();
            } else {
              this.tiktok.disconnect();
              if (this.tikfinity) this.tikfinity.disconnect();
            }
          }
        } catch (err) {}
      }

      // Sync Real Live Chat Messages
      if (e.key === this.liveChatKey && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload.type === 'LIVE_CHAT') {
            this.handleIncomingChat(payload.data, true);
          }
        } catch (err) {}
      }

      // Sync Real-Time Triggers (Test Chat, Voice Tests)
      if (e.key === this.triggerKey && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload.type === 'TEST_CHAT') {
            this.handleIncomingChat(payload.data, true);
          } else if (payload.type === 'TEST_TTS') {
            this.tts.testVoice();
          }
        } catch (err) {}
      }
    });
  }

  triggerTestChat(chatData) {
    this.handleIncomingChat(chatData, false);
  }

  triggerTestTTS() {
    this.tts.testVoice();

    try {
      localStorage.setItem(this.triggerKey, JSON.stringify({
        type: 'TEST_TTS',
        timestamp: Date.now()
      }));
    } catch (e) {}

    try {
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({ type: 'TEST_TTS', timestamp: Date.now() });
      }
    } catch (e) {}
  }

  bindDashboardEvents() {
    // Tab Switching & Breadcrumb Updates
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.dataset.tab;
        if (!targetTab) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        e.currentTarget.classList.add('active');
        const tabEl = document.getElementById(`tab-${targetTab}`);
        if (tabEl) tabEl.classList.add('active');

        // Update Topbar Breadcrumb
        const isStart = ['connections', 'test'].includes(targetTab);
        const sectionName = isStart ? 'START' : 'SET UP';
        const tabTitleMap = {
          connections: 'Connection',
          test: 'Simulasi',
          overlay: 'Chatbox',
          tts: 'Baca Komentar',
          viewcount: 'Viewcount',
          alerts: 'Alert'
        };
        const pageTitle = tabTitleMap[targetTab] || targetTab;
        const bcSection = document.getElementById('bc-section-name');
        const bcPage = document.getElementById('bc-page-name');
        if (bcSection) bcSection.textContent = sectionName;
        if (bcPage) bcPage.textContent = pageTitle;

        // Close mobile drawer on selection
        document.getElementById('main-sidebar')?.classList.remove('open');
        document.getElementById('sidebar-backdrop')?.classList.remove('active');
      });
    });

    // Mobile Sidebar Drawer Toggle
    const sidebar = document.getElementById('main-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      sidebar?.classList.toggle('open');
      backdrop?.classList.toggle('active');
    });
    backdrop?.addEventListener('click', () => {
      sidebar?.classList.remove('open');
      backdrop?.classList.remove('active');
    });

    // Kick Connect Button
    document.getElementById('btn-connect-kick')?.addEventListener('click', () => {
      const username = document.getElementById('input-kick-username').value;
      this.config.kickUsername = username;
      this.notifyConfigChange();
      this.kick.connect(username);
    });

    // Kick Disconnect
    document.getElementById('btn-disconnect-kick')?.addEventListener('click', () => {
      this.config.kickUsername = '';
      this.notifyConfigChange();
      this.kick.disconnect();
    });

    // YouTube Connect Button
    document.getElementById('btn-connect-youtube')?.addEventListener('click', () => {
      const input = document.getElementById('input-yt-url').value;
      const key = document.getElementById('input-yt-key').value;
      this.config.ytVideoInput = input;
      this.config.ytApiKey = key;
      this.notifyConfigChange();
      this.youtube.connect(input, key);
    });

    // YouTube Disconnect
    document.getElementById('btn-disconnect-youtube')?.addEventListener('click', () => {
      this.config.ytVideoInput = '';
      this.notifyConfigChange();
      this.youtube.disconnect();
    });

    // TikTok Connect Button
    document.getElementById('btn-connect-tiktok')?.addEventListener('click', () => {
      const username = document.getElementById('input-tiktok-username').value;
      const token = document.getElementById('input-tiktok-token')?.value || '';
      this.config.tiktokUsername = username;
      this.config.tiktokApiToken = token;
      this.notifyConfigChange();
      this.tiktok.connect(username, token);
      if (this.tikfinity) this.tikfinity.connect();
    });

    // TikTok Token change (persist tanpa harus reconnect)
    document.getElementById('input-tiktok-token')?.addEventListener('change', (e) => {
      this.config.tiktokApiToken = e.target.value;
      this.notifyConfigChange();
    });

    // TikTok Disconnect
    document.getElementById('btn-disconnect-tiktok')?.addEventListener('click', () => {
      this.config.tiktokUsername = '';
      this.notifyConfigChange();
      this.tiktok.disconnect();
      if (this.tikfinity) this.tikfinity.disconnect();
    });

    // TTS Settings Controls
    document.getElementById('switch-tts-enable')?.addEventListener('change', (e) => {
      this.config.ttsEnabled = e.target.checked;
      this.notifyConfigChange();
    });

    document.getElementById('range-tts-vol')?.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('val-tts-vol').innerText = `${Math.round(val * 100)}%`;
      this.config.ttsVolume = parseFloat(val);
      this.notifyConfigChange();
    });

    document.getElementById('range-tts-rate')?.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('val-tts-rate').innerText = `${val}x`;
      this.config.ttsRate = parseFloat(val);
      this.notifyConfigChange();
    });

    document.getElementById('range-tts-pitch')?.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('val-tts-pitch').innerText = `${val}`;
      this.config.ttsPitch = parseFloat(val);
      this.notifyConfigChange();
    });

    document.getElementById('input-tts-template')?.addEventListener('change', (e) => {
      this.config.ttsTemplate = e.target.value;
      this.notifyConfigChange();
    });

    document.getElementById('input-tts-blacklist')?.addEventListener('change', (e) => {
      this.config.ttsBlacklist = e.target.value;
      this.notifyConfigChange();
    });

    // Test Mbak Google TTS Button
    document.getElementById('btn-test-tts')?.addEventListener('click', () => {
      this.triggerTestTTS();
    });

    // Overlay Theme & Style Bindings
    document.getElementById('select-overlay-theme')?.addEventListener('change', (e) => {
      this.config.overlayTheme = e.target.value;
      this.notifyConfigChange();
    });

    document.getElementById('range-font-size')?.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('val-font-size').innerText = `${val}px`;
      this.config.overlayFontSize = parseInt(val);
      this.notifyConfigChange();
    });

    document.getElementById('select-overlay-anim')?.addEventListener('change', (e) => {
      this.config.overlayAnimation = e.target.value;
      this.notifyConfigChange();
    });

    document.getElementById('range-hide-duration')?.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('val-hide-duration').innerText = val == 0 ? 'Selamanya' : `${val}s`;
      this.config.overlayHideDuration = parseInt(val);
      this.notifyConfigChange();
    });

    // ViewCount: master switch + pilihan platform
    document.getElementById('switch-viewcount-enable')?.addEventListener('change', (e) => {
      this.config.viewCountEnabled = e.target.checked;
      this.notifyConfigChange();
    });
    ['kick', 'youtube', 'tiktok'].forEach((p) => {
      document.getElementById(`chk-vc-${p}`)?.addEventListener('change', (e) => {
        this.config.viewCountPlatforms[p] = e.target.checked;
        this.notifyConfigChange();
      });
    });

    // Test Chat Simulator Triggers
    document.getElementById('btn-test-kick-msg')?.addEventListener('click', () => {
      this.triggerTestChat({
        id: 'test-kick-' + Date.now(),
        platform: 'kick',
        username: 'KickGamer',
        userColor: '#53FC18',
        message: 'GGWP Bang! Mantap banget overlay Kick nya 🔥',
        avatar: 'https://kick.com/favicon.ico',
        timestamp: new Date()
      });
    });

    document.getElementById('btn-test-yt-msg')?.addEventListener('click', () => {
      this.triggerTestChat({
        id: 'test-yt-' + Date.now(),
        platform: 'youtube',
        username: 'YT_Subscriber',
        userColor: '#ff3333',
        message: 'Mbak Google tolong bacain ini, halo dari YouTube Live!',
        avatar: 'https://www.youtube.com/favicon.ico',
        timestamp: new Date()
      });
    });

    document.getElementById('btn-test-tiktok-msg')?.addEventListener('click', () => {
      this.triggerTestChat({
        id: 'test-tiktok-' + Date.now(),
        platform: 'tiktok',
        username: 'TikToker_Indo',
        userColor: '#00f2fe',
        message: 'Kirim Mawar banyak-banyak buat streamer 🌹✨',
        avatar: 'https://www.tiktok.com/favicon.ico',
        timestamp: new Date()
      });
    });

    // Alert Overlay Controls
    document.getElementById('range-alert-duration')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('val-alert-duration').innerText = `${val} detik`;
      this.config.alertDuration = val;
      this.notifyConfigChange();
    });

    document.getElementById('range-alert-volume')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      document.getElementById('val-alert-volume').innerText = `${Math.round(val * 100)}%`;
      this.config.alertSoundVolume = val;
      this.notifyConfigChange();
    });

    const alertKeys = ['yt_sub', 'kick_sub', 'tiktok_follow', 'tiktok_gift', 'tiktok_like'];
    alertKeys.forEach((key) => {
      // Switch Enable
      document.getElementById(`switch-alert-${key}`)?.addEventListener('change', (e) => {
        if (!this.config.alerts[key]) this.config.alerts[key] = {};
        this.config.alerts[key].enabled = e.target.checked;
        this.notifyConfigChange();
      });

      // Title Text
      document.getElementById(`input-title-${key}`)?.addEventListener('change', (e) => {
        if (!this.config.alerts[key]) this.config.alerts[key] = {};
        this.config.alerts[key].title = e.target.value;
        this.notifyConfigChange();
      });

      // Video URL Direct
      document.getElementById(`url-video-${key}`)?.addEventListener('change', (e) => {
        if (!this.config.alerts[key]) this.config.alerts[key] = {};
        this.config.alerts[key].videoUrl = e.target.value.trim();
        this.notifyConfigChange();
      });

      // Sound URL Direct
      document.getElementById(`url-sound-${key}`)?.addEventListener('change', (e) => {
        if (!this.config.alerts[key]) this.config.alerts[key] = {};
        this.config.alerts[key].soundUrl = e.target.value.trim();
        this.notifyConfigChange();
      });

      // Video File Upload
      const videoFileInput = document.getElementById(`file-video-${key}`);
      const videoUploadBtn = document.getElementById(`btn-upload-video-${key}`);
      const doUploadVideo = () => {
        if (videoFileInput && videoFileInput.files && videoFileInput.files[0]) {
          this.uploadMediaFile(videoFileInput.files[0], key, 'video', `status-video-${key}`);
        }
      };
      videoUploadBtn?.addEventListener('click', doUploadVideo);
      videoFileInput?.addEventListener('change', doUploadVideo);

      // Sound File Upload
      const soundFileInput = document.getElementById(`file-sound-${key}`);
      const soundUploadBtn = document.getElementById(`btn-upload-sound-${key}`);
      const doUploadSound = () => {
        if (soundFileInput && soundFileInput.files && soundFileInput.files[0]) {
          this.uploadMediaFile(soundFileInput.files[0], key, 'sound', `status-sound-${key}`);
        }
      };
      soundUploadBtn?.addEventListener('click', doUploadSound);
      soundFileInput?.addEventListener('change', doUploadSound);

      // Test Alert Button
      document.getElementById(`btn-test-alert-${key}`)?.addEventListener('click', () => {
        this.triggerTestAlert(key);
      });
    });

    // Copy OBS Overlay File Path Button (overlay chat, viewcount & alert terpisah)
    const copyObsPath = (btnId, file) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const baseUrl = window.location.href.replace('index.html', '').split('?')[0];
      const overlayPath = `${baseUrl}${file}`;
      navigator.clipboard.writeText(overlayPath).then(() => {
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Link OBS Tersalin!';
        btn.style.background = '#10b981';
        setTimeout(() => {
          btn.innerHTML = oldHtml;
          btn.style.background = '';
        }, 2000);
      });
    };
    document.getElementById('btn-copy-obs-url')?.addEventListener('click', () => copyObsPath('btn-copy-obs-url', 'overlay_chat.html'));
    document.getElementById('btn-copy-obs-vc-url')?.addEventListener('click', () => copyObsPath('btn-copy-obs-vc-url', 'overlay_viewcount.html'));
    document.getElementById('btn-copy-obs-alert-url')?.addEventListener('click', () => copyObsPath('btn-copy-obs-alert-url', 'overlay_alert.html'));

    // Open OBS Overlay Window Button
    const openObsWindow = (file, w, h) => {
      const baseUrl = window.location.href.replace('index.html', '').split('?')[0];
      window.open(`${baseUrl}${file}`, '_blank', `width=${w},height=${h}`);
    };
    document.getElementById('btn-open-obs-window')?.addEventListener('click', () => openObsWindow('overlay_chat.html', 550, 750));
    document.getElementById('btn-open-obs-vc-window')?.addEventListener('click', () => openObsWindow('overlay_viewcount.html', 700, 120));
    document.getElementById('btn-open-obs-alert-window')?.addEventListener('click', () => openObsWindow('overlay_alert.html', 1280, 720));
  }

  updateUIFromConfig() {
    if (document.getElementById('input-kick-username')) document.getElementById('input-kick-username').value = this.config.kickUsername;
    if (document.getElementById('input-yt-url')) document.getElementById('input-yt-url').value = this.config.ytVideoInput;
    if (document.getElementById('input-yt-key')) document.getElementById('input-yt-key').value = this.config.ytApiKey;
    if (document.getElementById('input-tiktok-username')) document.getElementById('input-tiktok-username').value = this.config.tiktokUsername;
    if (document.getElementById('input-tiktok-token')) document.getElementById('input-tiktok-token').value = this.config.tiktokApiToken || '';

    if (document.getElementById('switch-tts-enable')) document.getElementById('switch-tts-enable').checked = this.config.ttsEnabled;
    if (document.getElementById('range-tts-vol')) document.getElementById('range-tts-vol').value = this.config.ttsVolume;
    if (document.getElementById('val-tts-vol')) document.getElementById('val-tts-vol').innerText = `${Math.round(this.config.ttsVolume * 100)}%`;

    if (document.getElementById('range-tts-rate')) document.getElementById('range-tts-rate').value = this.config.ttsRate;
    if (document.getElementById('val-tts-rate')) document.getElementById('val-tts-rate').innerText = `${this.config.ttsRate}x`;

    if (document.getElementById('range-tts-pitch')) document.getElementById('range-tts-pitch').value = this.config.ttsPitch;
    if (document.getElementById('val-tts-pitch')) document.getElementById('val-tts-pitch').innerText = `${this.config.ttsPitch}`;

    if (document.getElementById('input-tts-template')) document.getElementById('input-tts-template').value = this.config.ttsTemplate;
    if (document.getElementById('input-tts-blacklist')) document.getElementById('input-tts-blacklist').value = this.config.ttsBlacklist;

    if (document.getElementById('select-overlay-theme')) document.getElementById('select-overlay-theme').value = this.config.overlayTheme;
    if (document.getElementById('range-font-size')) document.getElementById('range-font-size').value = this.config.overlayFontSize;
    if (document.getElementById('val-font-size')) document.getElementById('val-font-size').innerText = `${this.config.overlayFontSize}px`;

    if (document.getElementById('select-overlay-anim')) document.getElementById('select-overlay-anim').value = this.config.overlayAnimation;
    if (document.getElementById('range-hide-duration')) document.getElementById('range-hide-duration').value = this.config.overlayHideDuration;
    if (document.getElementById('val-hide-duration')) document.getElementById('val-hide-duration').innerText = this.config.overlayHideDuration == 0 ? 'Selamanya' : `${this.config.overlayHideDuration}s`;

    if (document.getElementById('switch-viewcount-enable')) document.getElementById('switch-viewcount-enable').checked = this.config.viewCountEnabled;
    ['kick', 'youtube', 'tiktok'].forEach((p) => {
      const el = document.getElementById(`chk-vc-${p}`);
      if (el) el.checked = this.config.viewCountPlatforms?.[p] !== false;
    });

    // Alert Overlay UI Sync
    if (document.getElementById('range-alert-duration')) {
      document.getElementById('range-alert-duration').value = this.config.alertDuration || 6;
      document.getElementById('val-alert-duration').innerText = `${this.config.alertDuration || 6} detik`;
    }
    if (document.getElementById('range-alert-volume')) {
      const vol = typeof this.config.alertSoundVolume === 'number' ? this.config.alertSoundVolume : 0.8;
      document.getElementById('range-alert-volume').value = vol;
      document.getElementById('val-alert-volume').innerText = `${Math.round(vol * 100)}%`;
    }

    if (this.config.alerts) {
      ['yt_sub', 'kick_sub', 'tiktok_follow', 'tiktok_gift', 'tiktok_like'].forEach((key) => {
        const item = this.config.alerts[key];
        if (!item) return;

        const sw = document.getElementById(`switch-alert-${key}`);
        if (sw) sw.checked = item.enabled !== false;

        const titleInput = document.getElementById(`input-title-${key}`);
        if (titleInput && item.title) titleInput.value = item.title;

        const videoInput = document.getElementById(`url-video-${key}`);
        if (videoInput && item.videoUrl) videoInput.value = item.videoUrl;

        const soundInput = document.getElementById(`url-sound-${key}`);
        if (soundInput && item.soundUrl) soundInput.value = item.soundUrl;

        const statVideo = document.getElementById(`status-video-${key}`);
        if (statVideo && item.videoUrl) {
          statVideo.innerHTML = `<span style="color:#10b981"><i class="bi bi-file-earmark-check-fill"></i> Media: ${item.videoUrl}</span>`;
        }

        const statSound = document.getElementById(`status-sound-${key}`);
        if (statSound && item.soundUrl) {
          statSound.innerHTML = `<span style="color:#10b981"><i class="bi bi-music-note-beamed"></i> Audio: ${item.soundUrl}</span>`;
        }
      });
    }
  }

  notifyConfigChange() {
    this.applyTTSSettings();
    this.applyRendererConfig();

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (e) {}
    
    // Sync to backend API for OBS Overlay access
    try {
      fetch('http://localhost:8765/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config)
      }).catch(err => console.warn('Config save error:', err));
    } catch (e) {}
  }

  async loadState() {
    let loadedConfig = {};
    
    // 1. Try to load from local backend API (solves OBS isolated localStorage issue)
    try {
      const res = await fetch('http://localhost:8765/api/config', { cache: 'no-store' });
      if (res.ok) {
        const backendConfig = await res.json();
        if (Object.keys(backendConfig).length > 0) {
          loadedConfig = backendConfig;
        }
      }
    } catch (e) {
      console.warn('Failed to load from API', e);
    }

    // 2. Fallback to LocalStorage
    let fellBackToLocal = false;
    if (Object.keys(loadedConfig).length === 0) {
      try {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) {
          loadedConfig = JSON.parse(saved);
          fellBackToLocal = true;
        }
      } catch (e) {}
    }

    if (Object.keys(loadedConfig).length > 0) {
      this.config = { ...this.config, ...loadedConfig };
    }
    
    // If we loaded from legacy localStorage, sync it up to the API immediately
    if (fellBackToLocal) {
      this.notifyConfigChange();
    }
  }
}
