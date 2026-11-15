/**
 * Alert Overlay Controller (OBS Studio & Browser)
 * Manages alert queues, custom MP4/GIF video rendering, audio soundboards, and cross-window sync.
 */

function getLocalServerBase() {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
    return window.location.origin;
  }
  return 'http://localhost:8765';
}

class AlertOverlayManager {
  constructor() {
    this.container = document.getElementById('alert-container');
    this.audioPlayer = document.getElementById('alert-audio-player');
    this.queue = [];
    this.isPlaying = false;
    this.currentAlertType = null;
    this.currentTimer = null;
    this.hideTimeout = null;
    this.processedAlertIds = new Map();
    this.recentFingerprints = new Map();
    this.lastLikeAlertTime = 0;

    this.config = {
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

    this.initSync();
    this.loadConfig();
  }

  async loadConfig() {
    try {
      const res = await fetch(`${getLocalServerBase()}/api/config`, { cache: 'no-store' });
      if (res.ok) {
        const remoteCfg = await res.json();
        this.mergeConfig(remoteCfg);
      }
    } catch (e) {
      try {
        const localCfg = localStorage.getItem('chat_overlay_mbak_google_config');
        if (localCfg) {
          this.mergeConfig(JSON.parse(localCfg));
        }
      } catch (err) {}
    }
  }

  mergeConfig(newCfg) {
    if (!newCfg) return;
    if (typeof newCfg.alertDuration === 'number') {
      this.config.alertDuration = Math.max(2, newCfg.alertDuration);
    }
    if (typeof newCfg.alertSoundVolume === 'number') {
      this.config.alertSoundVolume = Math.min(1, Math.max(0, newCfg.alertSoundVolume));
    }
    if (newCfg.alerts && typeof newCfg.alerts === 'object') {
      for (const key of Object.keys(newCfg.alerts)) {
        if (!this.config.alerts[key]) this.config.alerts[key] = {};
        this.config.alerts[key] = {
          ...this.config.alerts[key],
          ...newCfg.alerts[key]
        };
      }
    }
  }

  initSync() {
    try {
      this.broadcastChannel = new BroadcastChannel('zover_alert_channel');
      this.broadcastChannel.onmessage = (event) => {
        if (event && event.data) {
          this.handleIncomingBroadcast(event.data);
        }
      };
    } catch (e) {
      console.warn('[Alerts] BroadcastChannel not supported:', e);
    }

    window.addEventListener('storage', (event) => {
      if (event.key === 'chat_overlay_alert_trigger' && event.newValue) {
        try {
          const payload = JSON.parse(event.newValue);
          this.handleIncomingBroadcast(payload);
        } catch (e) {}
      } else if (event.key === 'chat_overlay_mbak_google_config' && event.newValue) {
        try {
          this.mergeConfig(JSON.parse(event.newValue));
        } catch (e) {}
      }
    });

    setInterval(() => this.loadConfig(), 5000);
    this.startServerEventsPolling();
  }

  startServerEventsPolling() {
    if (this.isEventsPollingActive || typeof window === 'undefined') return;
    this.isEventsPollingActive = true;
    let lastEventTimestamp = Date.now() - 2000;
    const eventsUrl = `${getLocalServerBase()}/api/events`;

    setInterval(async () => {
      try {
        const res = await fetch(`${eventsUrl}?since=${lastEventTimestamp}`, { cache: 'no-store' });
        if (res.ok) {
          const events = await res.json();
          if (Array.isArray(events) && events.length > 0) {
            for (const evt of events) {
              if (evt.timestamp > lastEventTimestamp) {
                lastEventTimestamp = evt.timestamp;
              }
              if (evt.type === 'ALERT_TRIGGER' && evt.data) {
                this.handleIncomingBroadcast(evt);
              }
            }
          }
        }
      } catch (_) {}
    }, 400);
  }

  handleIncomingBroadcast(payload) {
    if (!payload || !payload.type) return;

    if (payload.type === 'ALERT_TRIGGER' && payload.data) {
      const alertData = payload.data;
      const alertId = alertData.id || payload.id;
      const now = Date.now();

      for (const [k, ts] of this.processedAlertIds.entries()) {
        if (now - ts > 60000) this.processedAlertIds.delete(k);
      }
      if (alertId) {
        if (this.processedAlertIds.has(alertId)) {
          return;
        }
        this.processedAlertIds.set(alertId, now);
        if (this.processedAlertIds.size > 300) {
          const oldest = this.processedAlertIds.keys().next().value;
          this.processedAlertIds.delete(oldest);
        }
      }

      for (const [k, ts] of this.recentFingerprints.entries()) {
        if (now - ts > 10000) this.recentFingerprints.delete(k);
      }
      const fingerprint = `${alertData.platform || ''}_${alertData.type || ''}_${alertData.user || ''}_${alertData.gift || ''}_${alertData.count || ''}`.toLowerCase();
      const lastSeen = this.recentFingerprints.get(fingerprint) || 0;
      if (now - lastSeen < 5000) {
        return;
      }
      this.recentFingerprints.set(fingerprint, now);

      if (alertId && !alertData.id) {
        alertData.id = alertId;
      }
      this.enqueueAlert(alertData);
    } else if (payload.type === 'CONFIG_UPDATE' && payload.data) {
      this.mergeConfig(payload.data);
    }
  }

  enqueueAlert(alertData) {
    const alertType = alertData.type || 'yt_sub';
    const cfg = this.config.alerts[alertType] || {};

    if (cfg.enabled === false) {
      return;
    }

    if (alertType === 'tiktok_like') {
      const now = Date.now();
      const minInterval = (this.config.alertDuration || 6) * 1000;
      const hasLikeInQueue = (this.isPlaying && this.currentAlertType === 'tiktok_like') ||
        this.queue.some(item => item.type === 'tiktok_like');

      if (hasLikeInQueue || (now - this.lastLikeAlertTime < minInterval)) {
        return;
      }
      this.lastLikeAlertTime = now;
    }

    if (this.queue.length >= 30) {
      return;
    }

    this.queue.push({
      ...alertData,
      type: alertType,
      cfg: cfg
    });

    if (!this.isPlaying) {
      this.processQueue();
    }
  }

  processQueue() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.currentAlertType = null;
      return;
    }

    this.isPlaying = true;
    const currentAlert = this.queue.shift();
    this.currentAlertType = currentAlert.type || null;
    this.renderAlert(currentAlert);
  }

  renderAlert(alertItem) {
    if (!this.container) return;

    const { type, user, gift, count, cfg, platform } = alertItem;

    this.container.innerHTML = '';

    const stage = document.createElement('div');
    stage.className = 'alert-stage';

    const mediaBox = document.createElement('div');
    mediaBox.className = 'alert-media-box';

    const tag = document.createElement('div');
    tag.className = 'alert-platform-tag';
    const platformLabel = (platform || type.split('_')[0] || '').toUpperCase();
    tag.innerHTML = `<span>${this.escapeHtml(platformLabel)}</span>`;
    mediaBox.appendChild(tag);

    const videoUrl = (cfg && cfg.videoUrl ? cfg.videoUrl.trim() : '');
    const isVideo = videoUrl.match(/\.(mp4|webm|mov|ogg)($|\?)/i) || videoUrl.startsWith('data:video');
    const isImage = videoUrl.match(/\.(gif|png|jpg|jpeg|webp)($|\?)/i) || videoUrl.startsWith('data:image');

    if (videoUrl && isVideo) {
      const vid = document.createElement('video');
      vid.src = videoUrl;
      vid.autoplay = true;
      vid.loop = true;
      vid.muted = true; // Audio is played separately through the soundboard player.
      vid.playsInline = true;
      mediaBox.appendChild(vid);
    } else if (videoUrl && isImage) {
      const img = document.createElement('img');
      img.src = videoUrl;
      img.alt = 'Alert Media';
      mediaBox.appendChild(img);
    } else {
      const defaultDiv = document.createElement('div');
      defaultDiv.className = 'alert-default-gift';
      defaultDiv.innerHTML = `
        <svg class="gift-icon-svg" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 12 20 22 4 22 4 12"></polyline>
          <rect x="2" y="7" width="20" height="5"></rect>
          <line x1="12" y1="22" x2="12" y2="7"></line>
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
        </svg>
        <div class="gift-label">TEMPAT GIFT</div>
      `;
      mediaBox.appendChild(defaultDiv);
    }

    stage.appendChild(mediaBox);

    const textWrapper = document.createElement('div');
    textWrapper.className = 'alert-text-wrapper';

    let rawTitle = (cfg && cfg.title) ? cfg.title : 'TERIMA KASIH {user} SUDAH SUBS';
    const displayUser = user || 'Teman';
    const displayGift = gift || 'Gift';
    const displayCount = count !== undefined ? String(count) : '1';

    let formattedTitle = rawTitle
      .replace(/{user}/gi, `<span class="alert-highlight">${this.escapeHtml(displayUser)}</span>`)
      .replace(/{gift}/gi, `<span class="alert-highlight">${this.escapeHtml(displayGift)}</span>`)
      .replace(/{count}/gi, `<span class="alert-highlight">${this.escapeHtml(displayCount)}</span>`)
      .replace(/{platform}/gi, this.escapeHtml(platformLabel));

    const titleEl = document.createElement('div');
    titleEl.className = 'alert-main-title';
    titleEl.innerHTML = formattedTitle;
    textWrapper.appendChild(titleEl);

    if (cfg && cfg.subtext) {
      const subEl = document.createElement('div');
      subEl.className = 'alert-subtext';
      subEl.textContent = cfg.subtext;
      textWrapper.appendChild(subEl);
    }

    stage.appendChild(textWrapper);
    this.container.appendChild(stage);

    this.playSound(cfg ? cfg.soundUrl : '', alertItem);

    requestAnimationFrame(() => {
      stage.classList.add('alert-show');
    });

    const durationMs = (this.config.alertDuration || 6) * 1000;

    if (this.currentTimer) clearTimeout(this.currentTimer);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);

    this.currentTimer = setTimeout(() => {
      stage.classList.remove('alert-show');
      stage.classList.add('alert-hide');

      this.hideTimeout = setTimeout(() => {
        this.container.innerHTML = '';
        this.processQueue();
      }, 400);
    }, durationMs);
  }

  playSound(soundUrl, alertItem = {}) {
    if (!this.audioPlayer) return;

    // Hold lock for 60s across ID and fingerprint so queue drift between overlays never replays audio.
    const fp = `${alertItem.type || 'alert'}_${alertItem.user || ''}_${alertItem.gift || ''}_${alertItem.count || ''}`.toLowerCase();
    const idLockKey = alertItem.id ? `zover_alert_lock_${alertItem.id}` : null;
    const fpLockKey = `zover_alert_lock_fp_${fp}`;
    const lockTtlMs = 60000;
    try {
      const now = Date.now();
      const idLockTs = idLockKey ? parseInt(localStorage.getItem(idLockKey) || '0', 10) : 0;
      const fpLockTs = parseInt(localStorage.getItem(fpLockKey) || '0', 10);
      if ((idLockTs && (now - idLockTs) < lockTtlMs) || (fpLockTs && (now - fpLockTs) < lockTtlMs)) {
        return;
      }
      if (idLockKey) localStorage.setItem(idLockKey, String(now));
      localStorage.setItem(fpLockKey, String(now));
    } catch (_) {}

    const url = (soundUrl || 'media/alerts/default_alert.mp3').trim();
    if (!url) return;

    const startAudioPlayback = () => {
      try {
        this.audioPlayer.pause();
        this.audioPlayer.currentTime = 0;
        this.audioPlayer.src = url;
        this.audioPlayer.volume = typeof this.config.alertSoundVolume === 'number'
          ? this.config.alertSoundVolume
          : 0.8;

        const playPromise = this.audioPlayer.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            console.warn('[Alerts] Audio playback autoplay policy notice:', e);
          });
        }
      } catch (err) {
        console.warn('[Alerts] Audio error:', err);
      }
    };

    const useServerClaim = Boolean(
      typeof window !== 'undefined' &&
      !window.TestRunner &&
      typeof fetch === 'function' &&
      window.location &&
      /^https?:$/i.test(window.location.protocol || '')
    );

    if (useServerClaim) {
      (async () => {
        try {
          if (window.__zoverObsInactive) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          const origin = (window.location && window.location.origin && window.location.origin !== 'null')
            ? window.location.origin
            : 'http://127.0.0.1:8765';
          const params = new URLSearchParams();
          params.set('key', fpLockKey);
          if (idLockKey) params.set('id', idLockKey);
          params.set('ttl', '60000');
          const res = await fetch(`${origin}/api/claim?${params.toString()}`, { cache: 'no-store' });
          if (res && res.ok) {
            const data = await res.json();
            if (data && data.claimed === false) return;
          }
        } catch (_) {}
        startAudioPlayback();
      })();
      return;
    }

    startAudioPlayback();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  destroy() {
    this.queue = [];
    this.isPlaying = false;
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.audioPlayer) {
      try {
        this.audioPlayer.pause();
        this.audioPlayer.src = '';
      } catch (_) {}
    }
  }
}

// Inisialisasi Alert Overlay saat DOM siap
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    window.alertOverlay = new AlertOverlayManager();
  });
}

if (typeof window !== 'undefined') {
  try {
    if (!window.TestRunner && window.location && window.location.protocol === 'http:' && window.location.hostname === 'localhost' && typeof window.location.replace === 'function') {
      window.location.replace(window.location.href.replace('://localhost', '://127.0.0.1'));
    }
  } catch (_) {}

  window.addEventListener('beforeunload', () => {
    try {
      if (window.alertOverlay && typeof window.alertOverlay.destroy === 'function') {
        window.alertOverlay.destroy();
      }
    } catch (_) {}
  });
}
