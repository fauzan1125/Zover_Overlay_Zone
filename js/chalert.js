/**
 * Chalert - Unified Chat & Alert Dynamic Island Widget
 * Seamlessly integrates Live Chat (with Mbak Google TTS) and Stream Alerts (Gift, Sub, Follow, Like)
 * into a single Apple-spring animated capsule widget for OBS Browser Source and Dashboard Preview.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ChalertWidget = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";

  const PLATFORM_ICONS = {
    tiktok: 'logo_platform/tiktok.jpg',
    kick: 'logo_platform/kick.png',
    youtube: 'logo_platform/youtube.png'
  };

  class ChalertWidget {
    constructor(options = {}) {
      this.options = Object.assign({
        enabled: true,
        position: 'top-center',
        theme: 'iphone17-dark',
        showIdlePill: true,
        idleText: '@lazuri1125',
        enableChat: true,
        chatDisplayMs: 5000,
        soundVolume: 0.8,
        alertDuration: 5,
        ttsEnabled: true
      }, options);

      this.dom = {};
      this.currentAlert = null;
      this.alertQueue = [];
      this.pendingChat = null;
      this.chatHideTimer = null;
      this.alertTimer = null;
      this.seenMessageIds = new Set();
      this.seenAlertFingerprints = new Map();
      this.processedAlertIds = new Set();

      this.channels = {};
      this.isPollingAttached = false;
      this.isEventsPollingActive = false;

      // TTS Engine & Audio Player initialization
      this.currentAudio = null;
      if (typeof MbakGoogleTTS !== 'undefined') {
        this.tts = new MbakGoogleTTS();
      } else if (typeof window !== 'undefined' && window.MbakGoogleTTS) {
        this.tts = new window.MbakGoogleTTS();
      } else {
        this.tts = null;
      }
    }

    init(domElements = {}) {
      this.dom = {
        stage: domElements.stage || document.getElementById('chalertStage'),
        island: domElements.island || document.getElementById('chalertIsland'),
        idleView: domElements.idleView || document.getElementById('islandIdleView'),
        idleText: domElements.idleText || document.getElementById('islandIdleText'),
        cardView: domElements.cardView || document.getElementById('islandCardView'),
        avatar: domElements.avatar || document.getElementById('islandAvatar'),
        platformBadge: domElements.platformBadge || document.getElementById('islandPlatformBadge'),
        platformImg: domElements.platformImg || document.getElementById('islandPlatformImg'),
        username: domElements.username || document.getElementById('islandUsername'),
        tag: domElements.tag || document.getElementById('islandTag'),
        text: domElements.text || document.getElementById('islandText'),
        highlight: domElements.highlight || document.getElementById('islandHighlight'),
        sideIcon: domElements.sideIcon || document.getElementById('islandSideIcon'),
        sideGraphic: domElements.sideGraphic || document.getElementById('islandSideGraphic'),
        audioPlayer: domElements.audioPlayer || document.getElementById('chalertAudioPlayer')
      };

      this.applyConfig(this.options);
      if (!this.options.disableSync) {
        this.setupSyncChannels();
      }
      this.showIdle();
      if (!this.options.disableSync) {
        this.loadConfig();
      }

      return this;
    }

    applyConfig(config) {
      if (!config) return;
      this.options = Object.assign({}, this.options, config);

      if (typeof config.soundVolume === 'number') {
        this.options.soundVolume = Math.min(1, Math.max(0, config.soundVolume));
      }
      if (typeof config.ttsEnabled === 'boolean') {
        this.options.ttsEnabled = config.ttsEnabled;
      }

      if (this.dom.stage) {
        this.dom.stage.className = 'chalert-stage ' + (this.options.position === 'bottom-center' ? 'pos-bottom-center' : 'pos-top-center');
      }

      if (this.dom.island) {
        if (this.options.theme === 'iphone17-glass') {
          this.dom.island.classList.add('theme-glass');
        } else {
          this.dom.island.classList.remove('theme-glass');
        }
      }

      if (this.dom.idleText) {
        this.dom.idleText.textContent = this.options.idleText || '@live';
      }

      if (!this.currentAlert && !this.chatHideTimer) {
        this.showIdle();
      }
    }

    applyFullConfig(fullConfig) {
      if (!fullConfig) return;

      if (fullConfig.chalert) {
        this.applyConfig(fullConfig.chalert);
      }

      if (typeof fullConfig.alertSoundVolume === 'number') {
        this.options.soundVolume = Math.min(1, Math.max(0, fullConfig.alertSoundVolume));
      }

      if (typeof fullConfig.ttsEnabled === 'boolean') {
        this.options.ttsEnabled = fullConfig.ttsEnabled;
      }

      if (typeof fullConfig.alertDuration === 'number') {
        this.options.alertDuration = fullConfig.alertDuration;
      }

      if (this.tts) {
        this.tts.updateConfig(fullConfig);
      }

      this.fullConfig = fullConfig;
    }

    setupSyncChannels() {
      if (typeof window === 'undefined') return;

      // 1. Live Chat BroadcastChannel (Same as regular Chatbox)
      try {
        this.channels.chat = new BroadcastChannel('chat_overlay_channel');
        this.channels.chat.onmessage = (event) => {
          if ((event?.data?.type === 'LIVE_CHAT' || event?.data?.type === 'NEW_CHAT') && event.data.data) {
            this.handleIncomingChat(event.data.data);
          }
        };
      } catch (_) {}

      // 2. Alert BroadcastChannel (Same as regular Alert Overlay)
      try {
        this.channels.alert = new BroadcastChannel('zover_alert_channel');
        this.channels.alert.onmessage = (event) => {
          if (event?.data?.type === 'ALERT_TRIGGER' && event.data.data) {
            this.handleIncomingAlert(event.data.data);
          }
        };
      } catch (_) {}

      // 3. Chalert Simulator & Config Channel
      try {
        this.channels.chalert = new BroadcastChannel('zover_chalert_channel');
        this.channels.chalert.onmessage = (event) => {
          if (event?.data?.type === 'CHALERT_EVENT' && event.data.payload) {
            this.handleDirectChalertPayload(event.data.payload);
          } else if (event?.data?.type === 'CHALERT_CONFIG_UPDATE' && event.data.config) {
            this.applyConfig(event.data.config);
          }
        };
      } catch (_) {}

      // 4. LocalStorage Cross-Window Fallback (100% parity with ZoVer overlay)
      window.addEventListener('storage', (e) => {
        if (e.key === 'chat_overlay_mbak_google_live_chat' && e.newValue) {
          try {
            const p = JSON.parse(e.newValue);
            if ((p.type === 'LIVE_CHAT' || p.type === 'NEW_CHAT') && p.data) this.handleIncomingChat(p.data);
          } catch (_) {}
        } else if (e.key === 'chat_overlay_alert_trigger' && e.newValue) {
          try {
            const p = JSON.parse(e.newValue);
            if (p.type === 'ALERT_TRIGGER' && p.data) this.handleIncomingAlert(p.data);
          } catch (_) {}
        } else if (e.key === 'zover_chalert_event' && e.newValue) {
          try {
            const p = JSON.parse(e.newValue);
            if (p.type === 'CHALERT_EVENT' && p.payload) this.handleDirectChalertPayload(p.payload);
          } catch (_) {}
        } else if (e.key === 'chat_overlay_mbak_google_config' && e.newValue) {
          try {
            this.applyFullConfig(JSON.parse(e.newValue));
          } catch (_) {}
        } else if (e.key === 'zover_config' && e.newValue) {
          try {
            this.applyFullConfig(JSON.parse(e.newValue));
          } catch (_) {}
        }
      });

      // 5. Cross-Process Server Event Bridge for OBS CEF
      this.startServerEventsPolling();
    }

    startServerEventsPolling() {
      if (this.isEventsPollingActive || typeof window === 'undefined') return;
      this.isEventsPollingActive = true;
      this.lastEventTimestamp = Date.now() - 2000;
      const eventsUrl = this.getApiConfigUrl().replace('/api/config', '/api/events');

      setInterval(async () => {
        try {
          const res = await fetch(`${eventsUrl}?since=${this.lastEventTimestamp}`, { cache: 'no-store' });
          if (res.ok) {
            const events = await res.json();
            if (Array.isArray(events) && events.length > 0) {
              for (const evt of events) {
                if (evt.timestamp > this.lastEventTimestamp) {
                  this.lastEventTimestamp = evt.timestamp;
                }
                const evtId = evt.id || (evt.data && evt.data.id);
                if (evt.type === 'LIVE_CHAT' && evt.data) {
                  if (evtId && this.seenMessageIds.has(evtId)) continue;
                  this.handleIncomingChat(evt.data);
                } else if (evt.type === 'ALERT_TRIGGER' && evt.data) {
                  if (evtId && this.processedAlertIds.has(evtId)) continue;
                  this.handleIncomingAlert(evt.data);
                } else if (evt.type === 'CHALERT_EVENT' && (evt.data || evt.payload)) {
                  this.handleDirectChalertPayload(evt.data || evt.payload);
                }
              }
            }
          }
        } catch (_) {}
      }, 350);
    }

    getApiConfigUrl() {
      if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
        return `${window.location.origin}/api/config`;
      }
      return 'http://localhost:8765/api/config';
    }

    async loadConfig() {
      try {
        const res = await fetch(this.getApiConfigUrl(), { cache: 'no-store' });
        if (res.ok) {
          const cfg = await res.json();
          this.applyFullConfig(cfg);
        }
      } catch (_) {}

      if (!this.isPollingAttached && typeof window !== 'undefined') {
        this.isPollingAttached = true;
        setInterval(() => this.loadConfig(), 5000);
      }
    }

    sanitizeUrl(url) {
      if (!url || typeof url !== 'string') return DEFAULT_AVATAR;
      const trimmed = url.trim();
      if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('/') || trimmed.startsWith('media/') || trimmed.startsWith('logo_platform/')) {
        return trimmed;
      }
      return DEFAULT_AVATAR;
    }

    /**
     * Handle incoming live chat message with zero delay and TTS execution.
     */
    handleIncomingChat(chatData, skipTTS = false) {
      if (!chatData || !this.options.enabled) return;

      const rawMsg = chatData.message || chatData.text || '';
      const rawUser = chatData.username || chatData.user || 'Viewer';
      const timeWindow = Math.floor(Date.now() / 2500);
      const msgId = chatData.id || `${chatData.platform || 'chat'}_${rawUser}_${rawMsg}_${timeWindow}`;

      if (this.seenMessageIds.has(msgId)) return;
      this.seenMessageIds.add(msgId);
      if (this.seenMessageIds.size > 200) {
        const oldest = this.seenMessageIds.values().next().value;
        this.seenMessageIds.delete(oldest);
      }

      if (this.options.enableChat === false) return;

      // If a Major Alert is currently active on the island, store as pending
      if (this.currentAlert) {
        this.pendingChat = chatData;
        return;
      }

      // 3. Speak with Mbak Google TTS if enabled
      if (!skipTTS && this.options.ttsEnabled !== false && this.tts) {
        this.tts.speakMessage(chatData);
      }

      // 4. Render chat card immediately without any queue delay
      this.renderChatCard({
        platform: (chatData.platform || 'tiktok').toLowerCase(),
        username: rawUser,
        message: rawMsg,
        avatar: this.sanitizeUrl(chatData.avatar || chatData.userAvatar)
      });
    }

    renderChatCard(data) {
      const island = this.dom.island;
      if (!island) return;

      if (this.chatHideTimer) {
        clearTimeout(this.chatHideTimer);
        this.chatHideTimer = null;
      }

      island.classList.remove('state-idle', 'state-hidden', 'state-micro-alert', 'state-major-alert');
      island.classList.add('state-chat');
      island.style.setProperty('--chalert-accent', '#3B82F6');
      island.style.setProperty('--chalert-glow', 'rgba(59, 130, 246, 0.35)');

      if (this.dom.avatar) {
        this.dom.avatar.src = data.avatar;
        this.dom.avatar.onerror = () => { this.dom.avatar.src = DEFAULT_AVATAR; };
      }

      if (this.dom.platformImg) {
        this.dom.platformImg.src = PLATFORM_ICONS[data.platform] || PLATFORM_ICONS.tiktok;
        if (this.dom.platformBadge) this.dom.platformBadge.style.display = 'flex';
      }

      if (this.dom.username) {
        this.dom.username.textContent = data.username;
      }

      if (this.dom.tag) {
        this.dom.tag.style.display = 'none';
      }

      if (this.dom.highlight) {
        this.dom.highlight.style.display = 'none';
      }

      if (this.dom.text) {
        this.dom.text.textContent = data.message;
      }

      if (this.dom.sideGraphic) {
        this.dom.sideGraphic.style.display = 'none';
      }

      // Auto-shrink back to idle after duration
      const hideDuration = this.options.chatDisplayMs || 5000;
      this.chatHideTimer = setTimeout(() => {
        this.chatHideTimer = null;
        if (!this.currentAlert) {
          this.showIdle();
        }
      }, hideDuration);
    }

    getAlertConfig(type, platform = '') {
      const cfgObj = (this.fullConfig && this.fullConfig.alerts) ? this.fullConfig.alerts : (this.options && this.options.alerts ? this.options.alerts : {});
      if (!cfgObj) return {};

      const t = (type || '').toLowerCase();
      const p = (platform || '').toLowerCase();

      if (cfgObj[t]) return cfgObj[t];

      if (t.includes('gift')) return cfgObj.tiktok_gift || {};
      if (t.includes('like')) return cfgObj.tiktok_like || {};
      if (t.includes('follow')) return cfgObj.tiktok_follow || {};
      if (t.includes('sub')) {
        if (p.includes('kick')) return cfgObj.kick_sub || cfgObj.yt_sub || {};
        return cfgObj.yt_sub || cfgObj.kick_sub || {};
      }
      return {};
    }

    /**
     * Handle incoming stream alert (Gift, Follow, Like, Sub, Saweria).
     */
    handleIncomingAlert(alertData) {
      if (!alertData || !this.options.enabled) return;

      const aType = (alertData.type || 'alert').toLowerCase();
      const uName = alertData.user || 'Viewer';
      const pName = (alertData.platform || 'tiktok').toLowerCase();
      const alertId = alertData.id;

      // Filter duplicate payloads arriving from multiple sync channels
      if (alertId) {
        if (this.processedAlertIds.has(alertId)) return;
        this.processedAlertIds.add(alertId);
        setTimeout(() => this.processedAlertIds.delete(alertId), 15000);
      }

      // Filter rapid duplicate triggers within 2.5s
      const fp = `${pName}_${aType}_${uName}_${alertData.gift || ''}_${alertData.count || ''}`;
      const now = Date.now();
      const lastSeen = this.seenAlertFingerprints.get(fp) || 0;
      if (now - lastSeen < 2500) return;
      this.seenAlertFingerprints.set(fp, now);
      setTimeout(() => this.seenAlertFingerprints.delete(fp), 8000);

      // Check user alert config
      const alertCfg = this.getAlertConfig(aType, pName);
      if (alertCfg.enabled === false) return;

      const isMajor = aType.includes('gift') || aType.includes('sub') || aType.includes('donate');

      // Parity with overlay_alert.html title format
      let rawTitle = alertCfg.title || (isMajor ? 'TERIMA KASIH {user} SUDAH GIFT {gift} x{count}' : 'TERIMA KASIH {user}');
      const displayGift = alertData.gift || alertData.itemName || 'Gift';
      const displayCount = String(alertData.count || alertData.amount || 1);
      const formattedTitle = rawTitle
        .replace(/{user}/gi, uName)
        .replace(/{gift}/gi, displayGift)
        .replace(/{count}/gi, displayCount)
        .replace(/{platform}/gi, pName.toUpperCase());

      let soundUrl = (alertData.soundUrl || alertCfg.soundUrl || '').trim();
      if (!soundUrl && this.options.rules) {
        const ruleKey = aType.includes('gift') ? 'gift' : (aType.includes('sub') ? 'donation' : (aType.includes('like') ? 'like' : (aType.includes('follow') ? 'follow' : '')));
        if (ruleKey && this.options.rules[ruleKey] && this.options.rules[ruleKey].soundUrl) {
          soundUrl = this.options.rules[ruleKey].soundUrl;
        }
      }
      if (!soundUrl) {
        soundUrl = 'media/alerts/default_alert.mp3';
      }

      const videoUrl = alertData.videoUrl || alertCfg.videoUrl || '';

      const alertItem = {
        id: alertId,
        fp: fp,
        type: aType,
        isMajor,
        isTest: Boolean(alertData.isTest),
        platform: pName,
        user: uName,
        avatar: this.sanitizeUrl(alertData.avatar || alertData.userAvatar),
        gift: alertData.gift || alertData.itemName || '',
        count: alertData.count || alertData.amount || 1,
        comment: alertData.comment || alertData.subtext || '',
        formattedTitle: formattedTitle,
        soundUrl: soundUrl,
        videoUrl: videoUrl
      };

      if (this.currentAlert) {
        // Prevent duplicate alerts from entering the queue
        const isQueued = this.alertQueue.some(item => (item.id && item.id === alertId) || item.fp === fp);
        if (!isQueued) {
          this.alertQueue.push(alertItem);
        }
        return;
      }

      this.playAlert(alertItem);
    }

    playAlert(alertItem) {
      this.currentAlert = alertItem;

      // Play sound effect for this alert
      this.playSound(alertItem.soundUrl, alertItem);

      if (this.chatHideTimer) {
        clearTimeout(this.chatHideTimer);
        this.chatHideTimer = null;
      }
      if (this.alertTimer) {
        clearTimeout(this.alertTimer);
        this.alertTimer = null;
      }

      const island = this.dom.island;
      if (!island) return;

      island.classList.remove('state-idle', 'state-hidden', 'state-chat', 'state-micro-alert', 'state-major-alert');

      let accent = '#3B82F6';
      if (alertItem.isMajor) {
        accent = alertItem.type.includes('sub') ? '#10B981' : '#FF9500';
        island.classList.add('state-major-alert');
      } else {
        accent = alertItem.type.includes('like') ? '#EC4899' : '#3B82F6';
        island.classList.add('state-micro-alert');
      }

      island.style.setProperty('--chalert-accent', accent);
      island.style.setProperty('--chalert-glow', this.hexToRgba(accent, 0.5));

      if (this.dom.avatar) {
        this.dom.avatar.src = alertItem.avatar;
        this.dom.avatar.onerror = () => { this.dom.avatar.src = DEFAULT_AVATAR; };
      }

      if (this.dom.platformImg) {
        this.dom.platformImg.src = PLATFORM_ICONS[alertItem.platform] || PLATFORM_ICONS.tiktok;
        if (this.dom.platformBadge) this.dom.platformBadge.style.display = 'flex';
      }

      if (this.dom.username) {
        this.dom.username.textContent = alertItem.user;
      }

      if (this.dom.tag) {
        this.dom.tag.style.display = 'inline-block';
        this.dom.tag.textContent = alertItem.isMajor ? 'GIFT' : alertItem.type.replace('tiktok_', '').toUpperCase();
        this.dom.tag.className = 'island-tag accented';
      }

      if (this.dom.highlight) {
        if (alertItem.gift) {
          this.dom.highlight.style.display = 'block';
          const amt = alertItem.count > 1 ? ` x${alertItem.count}` : '';
          this.dom.highlight.textContent = `${alertItem.gift}${amt}`;
        } else {
          this.dom.highlight.style.display = 'none';
        }
      }

      if (this.dom.text) {
        let msg = alertItem.comment;
        if (!msg) {
          if (alertItem.formattedTitle) {
            msg = alertItem.formattedTitle;
          } else if (alertItem.type.includes('follow')) {
            msg = 'Mulai mengikuti siaran live';
          } else if (alertItem.type.includes('like')) {
            msg = `${alertItem.count} Tap-Tap Like Tercapai!`;
          } else if (alertItem.type.includes('sub')) {
            msg = 'Telah berlangganan (Subscribe)!';
          } else {
            msg = 'Mengirim apresiasi siaran';
          }
        }
        this.dom.text.textContent = msg;
      }

      if (this.dom.sideGraphic) {
        if (alertItem.isMajor) {
          this.dom.sideGraphic.style.display = 'flex';
          if (this.dom.sideIcon) {
            this.dom.sideIcon.src = alertItem.videoUrl || 'logo_platform/logo_app.png';
          }
        } else {
          this.dom.sideGraphic.style.display = 'none';
        }
      }

      const rawDur = (this.fullConfig && typeof this.fullConfig.alertDuration === 'number')
        ? this.fullConfig.alertDuration
        : (this.options.alertDuration || 6);
      const dur = Math.max(2, rawDur) * 1000;

      this.alertTimer = setTimeout(() => {
        this.alertTimer = null;
        this.currentAlert = null;

        if (this.alertQueue.length > 0) {
          this.playAlert(this.alertQueue.shift());
        } else if (this.pendingChat) {
          const chat = this.pendingChat;
          this.pendingChat = null;
          this.renderChatCard({
            platform: (chat.platform || 'tiktok').toLowerCase(),
            username: chat.username || chat.user || 'Viewer',
            message: chat.message || chat.text || '',
            avatar: this.sanitizeUrl(chat.avatar || chat.userAvatar)
          });
          if (this.options.ttsEnabled !== false && this.tts) {
            this.tts.speakMessage(chat);
          }
        } else {
          this.showIdle();
        }
      }, dur);
    }

    playSound(soundUrl, alertItem = {}) {
      if (this.options.isDashboardPreview && !alertItem.isTest) {
        return; // Don't duplicate sound on dashboard preview for real stream events
      }

      const url = (soundUrl || 'media/alerts/default_alert.mp3').trim();
      if (!url) return;

      // Cross-Scene / Cross-Source Audio Mutex: prevents double alert SFX if user has multiple scenes active in OBS
      const alertId = alertItem.id || `${alertItem.type || 'alert'}_${alertItem.user || ''}_${alertItem.gift || ''}_${alertItem.count || ''}`;
      const lockKey = `zover_alert_lock_${alertId}`;
      try {
        const existingLock = localStorage.getItem(lockKey);
        const now = Date.now();
        if (existingLock && (now - parseInt(existingLock, 10)) < 3500) {
          return;
        }
        localStorage.setItem(lockKey, String(now));
        setTimeout(() => {
          try { localStorage.removeItem(lockKey); } catch (_) {}
        }, 5000);
      } catch (_) {}

      const volume = typeof this.options.soundVolume === 'number'
        ? Math.min(1, Math.max(0, this.options.soundVolume))
        : 0.8;

      try {
        const player = this.dom.audioPlayer || document.getElementById('chalertAudioPlayer');
        if (player) {
          player.pause();
          player.currentTime = 0;
          player.src = url;
          player.volume = volume;
          const p = player.play();
          if (p !== undefined) {
            p.catch(e => console.warn('[Chalert] Audio playback notice:', e));
          }
        } else {
          if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
          }
          this.currentAudio = new Audio(url);
          this.currentAudio.volume = volume;
          const p = this.currentAudio.play();
          if (p !== undefined) {
            p.catch(e => console.warn('[Chalert] Audio playback notice:', e));
          }
        }
      } catch (err) {
        console.warn('[Chalert] Audio playback failed:', err);
      }
    }

    enqueue(payload) {
      return this.handleDirectChalertPayload(payload);
    }

    handleDirectChalertPayload(payload) {
      if (!payload) return;
      if (payload.category === 'chat') {
        this.handleIncomingChat({
          platform: payload.platform,
          username: payload.user?.username || payload.user,
          message: payload.payload?.text || payload.text,
          avatar: payload.user?.avatar_url || payload.avatar
        });
      } else {
        this.handleIncomingAlert({
          type: payload.type,
          platform: payload.platform,
          user: payload.user?.username || payload.user,
          avatar: payload.user?.avatar_url || payload.avatar,
          gift: payload.payload?.item_name || payload.gift,
          count: payload.payload?.amount || payload.count,
          comment: payload.payload?.text || payload.comment,
          soundUrl: payload.payload?.sound_url || payload.soundUrl
        });
      }
    }

    showIdle() {
      if (!this.dom.island) return;

      this.dom.island.classList.remove('state-chat', 'state-micro-alert', 'state-major-alert');

      if (!this.options.enabled) {
        this.dom.island.classList.add('state-hidden');
        return;
      }

      if (this.options.showIdlePill !== false) {
        this.dom.island.classList.remove('state-hidden');
        this.dom.island.classList.add('state-idle');
        if (this.dom.idleText) {
          this.dom.idleText.textContent = this.options.idleText || '@live';
        }
      } else {
        this.dom.island.classList.add('state-hidden');
      }
    }

    hexToRgba(hex, alpha = 0.4) {
      if (!hex || typeof hex !== 'string') return `rgba(59, 130, 246, ${alpha})`;
      let c = hex.replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      if (c.length === 6) {
        const num = parseInt(c, 16);
        return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
      }
      return `rgba(59, 130, 246, ${alpha})`;
    }
  }

  return ChalertWidget;
});
