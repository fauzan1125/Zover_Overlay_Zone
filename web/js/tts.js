/**
 * Mbak Google Text-to-Speech (TTS) Engine - REBUILT & FIXED
 * 100% Suara Perempuan Indonesia, Anti-Andika, Anti-Macet.
 */

class MbakGoogleTTS {
  constructor() {
    this.enabled = true;
    this.volume = 1.0;
    this.rate = 1.0;
    this.pitch = 1.0;
    this.gender = 'female';
    this.template = '{user} berkata {message}';

    this.platforms = { kick: true, youtube: true, tiktok: true };
    this.ignoredPrefixes = ['!', '/', '.', '$'];
    this.blacklistedWords = [];

    this.queue = [];
    this.pendingClaims = [];
    this.isPlaying = false;
    this.currentAudio = null;
    this.recentSpeechFps = new Map();
    this.seenEventIds = new Map();
    this.instanceId = `tts_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Web Speech API
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    this.selectedVoice = null;
    this.initVoiceSelection();
  }

  initVoiceSelection() {
    if (!this.synth) return;

    const selectVoice = () => {
      const voices = this.synth.getVoices();
      if (!voices || voices.length === 0) return;

      const indoVoices = voices.filter(v => v.lang === 'id-ID' || v.lang === 'id_ID');
      if (indoVoices.length === 0) {
        this.selectedVoice = null;
        return;
      }

      const wantMale = this.gender === 'male';

      let target = indoVoices.find(v => {
        const n = v.name.toLowerCase();
        return wantMale
          ? (n.match(/male|pria|laki|andika|ardan/) && !n.includes('female'))
          : (n.includes('google') || n.match(/female|wanita|perempuan|gadis/));
      });

      if (!target) {
        target = indoVoices.find(v => wantMale
          ? !v.name.toLowerCase().match(/female|wanita|perempuan|gadis/)
          : !v.name.toLowerCase().includes('andika'));
      }

      this.selectedVoice = target || indoVoices[0] || null;
      console.log(`[TTS] Selected ${this.gender} Voice:`, this.selectedVoice ? this.selectedVoice.name : 'Fallback Web Audio');
    };

    selectVoice();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = selectVoice;
    }
    this._reselectVoice = selectVoice;
  }

  updateConfig(settings = {}) {
    const enabledVal = settings.enabled !== undefined ? settings.enabled : settings.ttsEnabled;
    if (enabledVal !== undefined) {
      this.enabled = enabledVal;
      if (!this.enabled) this.stop();
    }
    // volume 0 itu valid (senyap); `|| 1.0` diam-diam meresetnya jadi full
    const volVal = settings.volume !== undefined ? settings.volume : settings.ttsVolume;
    if (volVal !== undefined) {
      const v = parseFloat(volVal);
      if (Number.isFinite(v)) this.volume = v;
    }
    const rateVal = settings.rate !== undefined ? settings.rate : settings.ttsRate;
    if (rateVal !== undefined) {
      const r = parseFloat(rateVal);
      if (Number.isFinite(r)) this.rate = r;
    }
    const pitchVal = settings.pitch !== undefined ? settings.pitch : settings.ttsPitch;
    if (pitchVal !== undefined) {
      const p = parseFloat(pitchVal);
      if (Number.isFinite(p)) this.pitch = p;
    }
    const genderVal = settings.gender !== undefined ? settings.gender : settings.ttsGender;
    if (genderVal !== undefined && genderVal !== this.gender) {
      this.gender = genderVal;
      if (this._reselectVoice) this._reselectVoice();
    }
    const tplVal = settings.template !== undefined ? settings.template : settings.ttsTemplate;
    if (tplVal !== undefined) this.template = tplVal;
    const platVal = settings.platforms || settings.ttsPlatforms;
    if (platVal) this.platforms = { ...this.platforms, ...platVal };
    const prefVal = settings.ignoredPrefixes !== undefined ? settings.ignoredPrefixes : settings.ttsIgnoredPrefixes;
    if (prefVal) {
      this.ignoredPrefixes = Array.isArray(prefVal) ? prefVal : String(prefVal).split(',').map(s => s.trim()).filter(Boolean);
    }
    const blVal = settings.blacklistedWords !== undefined ? settings.blacklistedWords : settings.ttsBlacklist;
    if (blVal !== undefined) {
      this.blacklistedWords = Array.isArray(blVal) ? blVal : String(blVal).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
  }

  /**
   * Cek dan catat deduplikasi event berdasarkan UUIDv4 / ID unik (FR-06).
   * Retensi: 60 detik, kapasitas maksimal 200 items.
   */
  isDuplicateEvent(id) {
    if (!id) return false;
    const now = Date.now();
    for (const [cachedId, timestamp] of this.seenEventIds.entries()) {
      if (now - timestamp > 60000) {
        this.seenEventIds.delete(cachedId);
      }
    }
    if (this.seenEventIds.has(id)) {
      return true;
    }
    this.seenEventIds.set(id, now);
    if (this.seenEventIds.size > 200) {
      const oldest = this.seenEventIds.keys().next().value;
      this.seenEventIds.delete(oldest);
    }
    return false;
  }

  speakMessage(chatData) {
    // isHistory dicek di mesin, bukan hanya di app.js, agar semua konsumen ikut kebal backlog
    if (!this.enabled || !chatData || !chatData.message || chatData.isHistory) return;

    // Deduplikasi UUIDv4 / ID pesan unik (FR-06)
    if (chatData.id && this.isDuplicateEvent(chatData.id)) {
      return;
    }

    const platform = (chatData.platform || 'youtube').toLowerCase();
    if (this.platforms[platform] === false) return;

    let msg = chatData.message.trim();
    if (this.ignoredPrefixes.some(p => msg.startsWith(p))) return;

    const msgLower = msg.toLowerCase();
    if (this.blacklistedWords.some(w => msgLower.includes(w))) return;

    // Bersihkan spam simbol (mis. @@@@) agar tidak dibaca aneh, tapi pertahankan @username
    msg = this.sanitizeForSpeech(msg);
    if (!msg) return;

    // Cross-Scene / Cross-Source Audio Mutex: prevents duplicate processing across open OBS scenes / windows
    const rawUser = chatData.username || chatData.user || 'Viewer';

    // Dedup by content as well as ID in case the same comment arrives through two bridges with distinct IDs.
    const testSuffix = chatData.isTest && chatData.id ? `|${chatData.id}` : '';
    const fp = `${platform}|${String(rawUser).toLowerCase()}|${msg.toLowerCase()}${testSuffix}`;
    const now = Date.now();
    for (const [k, ts] of this.recentSpeechFps.entries()) {
      if (now - ts > 60000) this.recentSpeechFps.delete(k);
    }
    const lastFp = this.recentSpeechFps.get(fp) || 0;
    if (now - lastFp < 15000) return;
    this.recentSpeechFps.set(fp, now);

    const fpKey = `zover_tts_lock_fp_${platform}_${String(rawUser).toLowerCase()}_${msg.toLowerCase().slice(0, 80)}${testSuffix}`;
    const idKey = chatData.id ? `zover_tts_lock_id_${chatData.id}` : null;
    const lockTtlMs = 60000;
    try {
      const existingFp = parseInt(localStorage.getItem(fpKey) || '0', 10);
      const existingId = idKey ? parseInt(localStorage.getItem(idKey) || '0', 10) : 0;
      if ((existingFp && (now - existingFp) < lockTtlMs) || (existingId && (now - existingId) < lockTtlMs)) {
        return;
      }
      localStorage.setItem(fpKey, String(now));
      if (idKey) localStorage.setItem(idKey, String(now));
    } catch (_) {}

    // Support multiple placeholder occurrences across template
    let text = this.template
      .replace(/{user}/gi, chatData.username || 'Seseorang')
      .replace(/{message}/gi, msg)
      .replace(/{platform}/gi, this.platformLabel(platform));

    // Bersihkan URL agar rapi
    text = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, 'sebuah tautan');

    this.pendingClaims.push({ text, fpKey, idKey });
    while (this.pendingClaims.length > 20) {
      this.pendingClaims.shift();
    }

    this.queue.push(text);
    // suara tidak boleh tertinggal jauh dari live: buang antrean tertua bila membanjir
    while (this.queue.length > 8) {
      this.queue.shift();
    }
    this.playNext();
  }

  /**
   * Nama platform yang enak dibacakan (mis. "youtube" -> "YouTube").
   */
  platformLabel(platform) {
    const map = { youtube: 'YouTube', kick: 'Kick', tiktok: 'TikTok' };
    return map[platform] || platform;
  }

  testVoice() {
    this.queue.push("Halo semuanya! Ini suara Mbak Google. Sudah diatur khusus suara perempuan.");
    this.playNext();
  }

  /**
   * Bersihkan teks khusus untuk SUARA (overlay tetap tampil asli).
   * - Buang spam '@' yang BUKAN mention (mis. "@@@@" yang dibaca "akeong" berulang).
   * - PERTAHANKAN '@username' (mention) agar tidak hilang.
   * - Ciutkan run simbol berulang (!!!, ???, dll) jadi satu spasi.
   */
  sanitizeForSpeech(text) {
    if (!text) return '';
    let t = String(text);

    // 1) Hapus run '@' yang TIDAK diikuti karakter username (huruf/angka/underscore).
    //    "@@@@" -> hilang, tapi "@budi" tetap utuh.
    t = t.replace(/@+(?![A-Za-z0-9_])/g, ' ');

    // 2) Ciutkan run simbol berulang (3x+) selain huruf/angka/emoji jadi satu spasi.
    t = t.replace(/([^\w\s\u00C0-\uFFFF])\1{2,}/g, ' ');

    // 3) Rapikan spasi ganda.
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  clearActiveSession() {
    try {
      const activeLockKey = 'zover_tts_active_session';
      const rawActive = localStorage.getItem(activeLockKey);
      if (rawActive) {
        const active = JSON.parse(rawActive);
        if (active && active.instanceId === this.instanceId) {
          localStorage.removeItem(activeLockKey);
        }
      }
    } catch (_) {}
  }

  shouldUseServerClaim() {
    return Boolean(
      typeof window !== 'undefined' &&
      !window.TestRunner &&
      typeof fetch === 'function' &&
      window.location &&
      /^https?:$/i.test(window.location.protocol || '')
    );
  }

  async claimServerAudio(fpKey, idKey) {
    try {
      if (typeof window !== 'undefined' && window.__zoverObsInactive) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      const origin = (window.location && window.location.origin && window.location.origin !== 'null')
        ? window.location.origin
        : 'http://127.0.0.1:8765';
      const params = new URLSearchParams();
      if (fpKey) params.set('key', fpKey);
      if (idKey) params.set('id', idKey);
      params.set('ttl', '60000');
      const res = await fetch(`${origin}/api/claim?${params.toString()}`, { cache: 'no-store' });
      if (res && res.ok) {
        const data = await res.json();
        return Boolean(data && data.claimed !== false);
      }
    } catch (_) {}
    return true;
  }

  playNext() {
    if (this.isPlaying || this.queue.length === 0) return;

    // Global Active Session Guard: jika ada window/scene lain yang sedang berbicara, antrean kita harus menunggu
    const activeLockKey = 'zover_tts_active_session';
    try {
      const rawActive = localStorage.getItem(activeLockKey);
      if (rawActive) {
        const active = JSON.parse(rawActive);
        if (active && active.instanceId !== this.instanceId && (Date.now() - active.startedAt) < 20000) {
          // Window lain sedang aktif memutar suara. Tunda dan periksa kembali secara tertib.
          setTimeout(() => this.playNext(), 350);
          return;
        }
      }
    } catch (_) {}

    this.isPlaying = true;
    const text = this.queue.shift();

    let claimEntry = null;
    if (this.pendingClaims && this.pendingClaims.length > 0) {
      const idx = this.pendingClaims.findIndex(item => item.text === text);
      if (idx !== -1) {
        claimEntry = this.pendingClaims.splice(idx, 1)[0];
      }
    }

    const startPlayback = () => {
      try {
        localStorage.setItem(activeLockKey, JSON.stringify({
          instanceId: this.instanceId,
          startedAt: Date.now()
        }));
      } catch (_) {}

      if (this.synth && this.selectedVoice) {
        this.speakWithSpeechSynthesis(text);
        return;
      }

      this.speakWithOnlineAudio(text);
    };

    if (claimEntry && this.shouldUseServerClaim()) {
      this.claimServerAudio(claimEntry.fpKey, claimEntry.idKey).then((claimed) => {
        if (!claimed) {
          this.clearActiveSession();
          this.isPlaying = false;
          if (this.queue.length > 0) {
            setTimeout(() => this.playNext(), 100);
          }
          return;
        }
        startPlayback();
      });
      return;
    }

    startPlayback();
  }

  speakWithSpeechSynthesis(text) {
    try {
      // jangan biarkan audio Google fallback dari antrean sebelumnya menumpangi utterance ini
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio = null;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance; // Retain reference to prevent Chromium GC freeze bug
      utterance.voice = this.selectedVoice;
      utterance.lang = 'id-ID';
      utterance.volume = Math.min(Math.max(this.volume, 0), 1);
      utterance.rate = Math.min(Math.max(this.rate, 0.5), 2);
      utterance.pitch = Math.min(Math.max(this.pitch, 0.5), 1.5);

      if (this.speechWatchdog) {
        clearTimeout(this.speechWatchdog);
        this.speechWatchdog = null;
      }

      let hasFinished = false;
      const finish = () => {
        if (hasFinished) return;
        hasFinished = true;
        if (this.speechWatchdog) {
          clearTimeout(this.speechWatchdog);
          this.speechWatchdog = null;
        }
        this.currentUtterance = null;
        this.clearActiveSession();
        this.isPlaying = false;
        // Jeda natural 350ms sebelum memutar komentar antrean berikutnya
        setTimeout(() => this.playNext(), 350);
      };

      utterance.onend = finish;
      utterance.onerror = (err) => {
        if (hasFinished) return;
        if (this.speechWatchdog) {
          clearTimeout(this.speechWatchdog);
          this.speechWatchdog = null;
        }
        this.currentUtterance = null;

        if (err && (err.error === 'canceled' || err.error === 'interrupted')) {
          this.clearActiveSession();
          this.isPlaying = false;
          hasFinished = true;
          if (this.queue.length > 0) {
            setTimeout(() => this.playNext(), 350);
          }
          return;
        }

        console.warn("[TTS] WebSpeech error, mencoba Online Audio fallback:", err);
        hasFinished = true;
        try { if (this.synth) this.synth.cancel(); } catch (_) {}
        this.speakWithOnlineAudio(text);
      };

      // CEF sometimes drops onend while speech is still active; extend while speaking, then cancel before advancing.
      const armWatchdog = (delay, retries) => {
        this.speechWatchdog = setTimeout(() => {
          if (hasFinished || this.currentUtterance !== utterance) return;
          if (this.synth && this.synth.speaking && retries < 5) {
            armWatchdog(Math.max(4000, text.length * 100), retries + 1);
            return;
          }
          console.warn("[TTS] SpeechSynthesis watchdog triggered (force finish).");
          try { if (this.synth) this.synth.cancel(); } catch (_) {}
          finish();
        }, delay);
      };
      armWatchdog(Math.max(12000, text.length * 350), 0);

      this.synth.speak(utterance);
    } catch (e) {
      this.currentUtterance = null;
      try { if (this.synth) this.synth.cancel(); } catch (_) {}
      this.speakWithOnlineAudio(text);
    }
  }

  speakWithOnlineAudio(text) {
    this.isPlaying = true;
    const cleanText = text.substring(0, 180);
    const url = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=id&q=${encodeURIComponent(cleanText)}`;

    let hasFinished = false;
    let watchdog = null;

    const finish = () => {
      if (hasFinished) return;
      hasFinished = true;
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      if (this.currentAudio) {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio = null;
      }
      this.clearActiveSession();
      this.isPlaying = false;
      // Jeda natural 350ms sebelum memutar komentar antrean berikutnya
      setTimeout(() => this.playNext(), 350);
    };

    try {
      // WebSpeech yang masih berbunyi harus berhenti dulu; kalau tidak,
      // audio ini menumpangi teks yang sama = suara dobel
      if (this.synth && this.synth.speaking) {
        try { this.synth.cancel(); } catch (_) {}
      }

      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio = null;
      }

      this.currentAudio = new Audio(url);
      this.currentAudio.volume = Math.min(Math.max(this.volume, 0), 1);
      this.currentAudio.playbackRate = Math.min(Math.max(this.rate, 0.5), 2);

      this.currentAudio.onended = finish;
      this.currentAudio.onerror = (e) => {
        console.warn("[TTS] Google Audio Error:", e);
        finish();
      };

      // Watchdog mengikuti panjang teks; 15s fixed memotong audio panjang di tengah kalimat.
      // Perpanjangan dibatasi 3x agar audio yang stall (paused=false tapi macet) tidak menggantung selamanya
      const estMs = Math.max(15000, cleanText.length * 250);
      const armAudioWatchdog = (retries) => {
        watchdog = setTimeout(() => {
          if (hasFinished) return;
          if (this.currentAudio && !this.currentAudio.paused && !this.currentAudio.ended && retries < 3) {
            armAudioWatchdog(retries + 1);
            return;
          }
          console.warn("[TTS] Google Audio watchdog triggered.");
          finish();
        }, estMs);
      };
      armAudioWatchdog(0);

      const playPromise = this.currentAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn("[TTS] Autoplay terhalang browser. Diperlukan 1x klik pada browser/overlay:", err);
          finish();
        });
      }
    } catch (err) {
      console.warn("[TTS] Audio setup failed:", err);
      finish();
    }
  }

  stop() {
    this.queue = [];
    this.pendingClaims = [];
    this.isPlaying = false;
    this.clearActiveSession();
    if (this.speechWatchdog) {
      clearTimeout(this.speechWatchdog);
      this.speechWatchdog = null;
    }
    this.currentUtterance = null;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio = null;
    }
    if (this.synth) {
      try { this.synth.cancel(); } catch (_) {}
    }
  }
}

// Lifecycle Guard: Batalkan Web Speech API saat instance OBS/tab dimuat ulang atau ditutup
if (typeof window !== 'undefined') {
  window.__zoverObsInactive = false;
  try {
    if (!window.TestRunner && window.location && window.location.protocol === 'http:' && window.location.hostname === 'localhost' && typeof window.location.replace === 'function') {
      window.location.replace(window.location.href.replace('://localhost', '://127.0.0.1'));
    }
  } catch (_) {}

  try {
    if (window.obsstudio && typeof window.obsstudio.getStatus === 'function') {
      window.obsstudio.getStatus((status) => {
        if (status && status.active === false) {
          window.__zoverObsInactive = true;
        }
      });
    }
    window.addEventListener('obsSourceActiveChanged', (e) => {
      if (e && e.detail && typeof e.detail.active === 'boolean') {
        window.__zoverObsInactive = !e.detail.active;
      }
    });
  } catch (_) {}

  try {
    if ('BroadcastChannel' in window) {
      const zoverTabChannel = new BroadcastChannel('zover_tts_channel');
      zoverTabChannel.postMessage({ type: 'NEW_TAB_ACTIVE' });
      zoverTabChannel.onmessage = (e) => {
        if (e.data && e.data.type === 'NEW_TAB_ACTIVE') {
          if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (_) {}
          }
        }
      };
    }
  } catch (_) {}

  window.addEventListener('beforeunload', () => {
    try {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {}
  });
  window.MbakGoogleTTS = MbakGoogleTTS;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MbakGoogleTTS;
}