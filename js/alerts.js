/**
 * Alert Overlay Controller (OBS Studio & Browser)
 * Manages alert queues, custom MP4/GIF video rendering, audio soundboards, and cross-window sync.
 */

class AlertOverlayManager {
  constructor() {
    this.container = document.getElementById('alert-container');
    this.audioPlayer = document.getElementById('alert-audio-player');
    this.queue = [];
    this.isPlaying = false;
    this.currentTimer = null;
    this.hideTimeout = null;
    this.processedAlertIds = new Set();
    this.recentFingerprints = new Map();
    this.lastLikeAlertTime = 0;

    // Default Config
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
      // 1. Ambil dari server lokal
      const res = await fetch('http://localhost:8765/api/config', { cache: 'no-store' });
      if (res.ok) {
        const remoteCfg = await res.json();
        this.mergeConfig(remoteCfg);
      }
    } catch (e) {
      // 2. Fallback ke LocalStorage
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
    // 1. BroadcastChannel API
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

    // 2. LocalStorage StorageEvent fallback
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

    // 3. Polling config tiap 5 detik untuk update realtime dari dashboard
    setInterval(() => this.loadConfig(), 5000);
  }

  handleIncomingBroadcast(payload) {
    if (!payload || !payload.type) return;

    if (payload.type === 'ALERT_TRIGGER' && payload.data) {
      const alertData = payload.data;
      const alertId = payload.id || alertData.id;

      // Filter duplicate payloads arriving from both BroadcastChannel and localStorage
      if (alertId) {
        if (this.processedAlertIds.has(alertId)) {
          return;
        }
        this.processedAlertIds.add(alertId);
        setTimeout(() => this.processedAlertIds.delete(alertId), 15000);
      }

      // Filter rapid duplicate triggers within 1500ms
      const fingerprint = `${alertData.platform || ''}_${alertData.type || ''}_${alertData.user || ''}_${alertData.gift || ''}_${alertData.count || ''}`;
      const now = Date.now();
      const lastSeen = this.recentFingerprints.get(fingerprint) || 0;
      if (now - lastSeen < 1500) {
        return;
      }
      this.recentFingerprints.set(fingerprint, now);
      setTimeout(() => this.recentFingerprints.delete(fingerprint), 5000);

      this.enqueueAlert(alertData);
    } else if (payload.type === 'CONFIG_UPDATE' && payload.data) {
      this.mergeConfig(payload.data);
    }
  }

  enqueueAlert(alertData) {
    const alertType = alertData.type || 'yt_sub';
    const cfg = this.config.alerts[alertType] || {};

    if (cfg.enabled === false) {
      return; // Dimatikan oleh user
    }

    if (alertType === 'tiktok_like') {
      const now = Date.now();
      const minInterval = (this.config.alertDuration || 6) * 1000;
      const hasLikeInQueue = this.queue.some(item => item.type === 'tiktok_like');

      if (hasLikeInQueue || (now - this.lastLikeAlertTime < minInterval)) {
        return;
      }
      this.lastLikeAlertTime = now;
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
      return;
    }

    this.isPlaying = true;
    const currentAlert = this.queue.shift();
    this.renderAlert(currentAlert);
  }

  renderAlert(alertItem) {
    if (!this.container) return;

    const { type, user, gift, count, cfg, platform } = alertItem;

    // Bersihkan container sebelumnya
    this.container.innerHTML = '';

    // Buat stage
    const stage = document.createElement('div');
    stage.className = 'alert-stage';

    // 1. KOTAK MEDIA ("TEMPAT GIFT")
    const mediaBox = document.createElement('div');
    mediaBox.className = 'alert-media-box';

    // Platform Tag
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
      vid.muted = true; // Audio di-handle soundboard audio player
      vid.playsInline = true;
      mediaBox.appendChild(vid);
    } else if (videoUrl && isImage) {
      const img = document.createElement('img');
      img.src = videoUrl;
      img.alt = 'Alert Media';
      mediaBox.appendChild(img);
    } else {
      // Default: Kotak Kuning Ikonik bertuliskan "TEMPAT GIFT" persis gambar referensi
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

    // 2. TEKS UCAPAN DI BAWAH KOTAK
    const textWrapper = document.createElement('div');
    textWrapper.className = 'alert-text-wrapper';

    // Format Template Teks
    let rawTitle = (cfg && cfg.title) ? cfg.title : 'TERIMA KASIH {user} SUDAH SUBS';
    const displayUser = user || 'Teman';
    const displayGift = gift || 'Gift';
    const displayCount = count !== undefined ? String(count) : '1';

    let formattedTitle = rawTitle
      .replace(/{user}/gi, `<span class="alert-highlight">${this.escapeHtml(displayUser)}</span>`)
      .replace(/{gift}/gi, `<span class="alert-highlight">${this.escapeHtml(displayGift)}</span>`)
      .replace(/{count}/gi, `<span class="alert-highlight">${displayCount}</span>`)
      .replace(/{platform}/gi, this.escapeHtml(platformLabel));

    const titleEl = document.createElement('div');
    titleEl.className = 'alert-main-title';
    titleEl.innerHTML = formattedTitle;
    textWrapper.appendChild(titleEl);

    // Subtext kecil (opsional)
    if (cfg && cfg.subtext) {
      const subEl = document.createElement('div');
      subEl.className = 'alert-subtext';
      subEl.textContent = cfg.subtext;
      textWrapper.appendChild(subEl);
    }

    stage.appendChild(textWrapper);
    this.container.appendChild(stage);

    // 3. MAINKAN SOUNDBOARD AUDIO
    this.playSound(cfg ? cfg.soundUrl : '');

    // 4. TRIGGER ANIMASI SHOW
    requestAnimationFrame(() => {
      stage.classList.add('alert-show');
    });

    // 5. TUNGGU DURASI LALU HIDE & PLAY NEXT
    const durationMs = (this.config.alertDuration || 6) * 1000;

    if (this.currentTimer) clearTimeout(this.currentTimer);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);

    this.currentTimer = setTimeout(() => {
      stage.classList.remove('alert-show');
      stage.classList.add('alert-hide');

      this.hideTimeout = setTimeout(() => {
        this.container.innerHTML = '';
        this.processQueue();
      }, 400); // Selesai transisi keluar
    }, durationMs);
  }

  playSound(soundUrl) {
    if (!this.audioPlayer) return;

    const url = (soundUrl || 'media/alerts/default_alert.mp3').trim();
    if (!url) return;

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
}

// Inisialisasi Alert Overlay saat DOM siap
document.addEventListener('DOMContentLoaded', () => {
  window.alertOverlay = new AlertOverlayManager();
});
