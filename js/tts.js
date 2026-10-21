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
    this.isPlaying = false;
    this.currentAudio = null;
    this.recentSpeechFps = new Map();
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

      // 1. Cari suara yang cocok dengan gender terpilih
      let target = indoVoices.find(v => {
        const n = v.name.toLowerCase();
        return wantMale
          ? (n.match(/male|pria|laki|andika|ardan/) && !n.includes('female'))
          : (n.includes('google') || n.match(/female|wanita|perempuan|gadis/));
      });

      // 2. Fallback: hindari suara yang berlawanan dengan gender
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
    if (settings.enabled !== undefined) {
      this.enabled = settings.enabled;
      if (!this.enabled) this.stop();
    }
    // volume 0 itu valid (senyap); `|| 1.0` diam-diam meresetnya jadi full
    if (settings.volume !== undefined) {
      const v = parseFloat(settings.volume);
      if (Number.isFinite(v)) this.volume = v;
    }
    if (settings.rate !== undefined) {
      const r = parseFloat(settings.rate);
      if (Number.isFinite(r)) this.rate = r;
    }
    if (settings.pitch !== undefined) {
      const p = parseFloat(settings.pitch);
      if (Number.isFinite(p)) this.pitch = p;
    }
    if (settings.gender !== undefined && settings.gender !== this.gender) {
      this.gender = settings.gender;
      if (this._reselectVoice) this._reselectVoice();
    }
    if (settings.template !== undefined) this.template = settings.template;
    if (settings.platforms) this.platforms = { ...this.platforms, ...settings.platforms };
    if (settings.ignoredPrefixes) {
      this.ignoredPrefixes = Array.isArray(settings.ignoredPrefixes) ? settings.ignoredPrefixes : settings.ignoredPrefixes.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (settings.blacklistedWords) {
      this.blacklistedWords = Array.isArray(settings.blacklistedWords) ? settings.blacklistedWords : settings.blacklistedWords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
  }

  speakMessage(chatData) {
    // isHistory dicek di mesin, bukan hanya di app.js, agar semua konsumen ikut kebal backlog
    if (!this.enabled || !chatData || !chatData.message || chatData.isHistory) return;

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

    // Dedup by content: pesan sama yang masuk lewat dua jalur bisa membawa ID berbeda,
    // jadi kunci per-ID saja tidak cukup
    const fp = `${platform}|${String(rawUser).toLowerCase()}|${msg.toLowerCase()}`;
    const now = Date.now();
    const lastFp = this.recentSpeechFps.get(fp) || 0;
    if (now - lastFp < 8000) return;
    this.recentSpeechFps.set(fp, now);
    if (this.recentSpeechFps.size > 200) {
      this.recentSpeechFps = new Map(Array.from(this.recentSpeechFps.entries()).slice(-100));
    }

    const lockKey = `zover_tts_lock_${chatData.id || (platform + '_' + rawUser + '_' + msg.slice(0, 50))}`;
    try {
      const existingLock = localStorage.getItem(lockKey);
      if (existingLock && (now - parseInt(existingLock, 10)) < 25000) {
        return; // Already claimed or spoken by another window/scene
      }
      localStorage.setItem(lockKey, String(now));
      setTimeout(() => {
        try { localStorage.removeItem(lockKey); } catch (_) {}
      }, 30000);
    } catch (_) {}

    // Support multiple placeholder occurrences across template
    let text = this.template
      .replace(/{user}/gi, chatData.username || 'Seseorang')
      .replace(/{message}/gi, msg)
      .replace(/{platform}/gi, this.platformLabel(platform));

    // Bersihkan URL agar rapi
    text = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, 'sebuah tautan');

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

    // Tandai sesi suara global aktif agar browser source lain hening
    try {
      localStorage.setItem(activeLockKey, JSON.stringify({
        instanceId: this.instanceId,
        startedAt: Date.now()
      }));
    } catch (_) {}

    // Prioritas 1: Jika browser punya voice asli sesuai gender (Chrome / Edge modern)
    if (this.synth && this.selectedVoice) {
      this.speakWithSpeechSynthesis(text);
      return;
    }

    // Prioritas 2: Fallback ke Online Audio (Mbak Google Asli)
    this.speakWithOnlineAudio(text);
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

        // Jika dibatalkan atau terinterupsi secara sengaja, jangan fallback ke Google Audio
        if (err && (err.error === 'canceled' || err.error === 'interrupted')) {
          this.clearActiveSession();
          this.isPlaying = false;
          hasFinished = true;
          return;
        }

        console.warn("[TTS] WebSpeech error, mencoba Online Audio fallback:", err);
        hasFinished = true;
        try { if (this.synth) this.synth.cancel(); } catch (_) {}
        this.speakWithOnlineAudio(text);
      };

      // Watchdog anti-hang, tapi cek dulu: CEF sering tidak fire onend padahal ucapan masih jalan,
      // dan finish prematur membuat komentar berikutnya menimpa suara yang sedang berbunyi
      const armWatchdog = (delay, retries) => {
        this.speechWatchdog = setTimeout(() => {
          if (hasFinished || this.currentUtterance !== utterance) return;
          if (this.synth && this.synth.speaking && retries < 5) {
            armWatchdog(Math.max(4000, text.length * 100), retries + 1);
            return;
          }
          console.warn("[TTS] SpeechSynthesis watchdog triggered (force finish).");
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

window.MbakGoogleTTS = MbakGoogleTTS;