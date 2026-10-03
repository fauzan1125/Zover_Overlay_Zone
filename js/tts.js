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
    if (settings.volume !== undefined) this.volume = parseFloat(settings.volume) || 1.0;
    if (settings.rate !== undefined) this.rate = parseFloat(settings.rate) || 1.0;
    if (settings.pitch !== undefined) this.pitch = parseFloat(settings.pitch) || 1.0;
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
    if (!this.enabled || !chatData || !chatData.message) return;

    const platform = (chatData.platform || 'youtube').toLowerCase();
    if (this.platforms[platform] === false) return;

    let msg = chatData.message.trim();
    if (this.ignoredPrefixes.some(p => msg.startsWith(p))) return;

    const msgLower = msg.toLowerCase();
    if (this.blacklistedWords.some(w => msgLower.includes(w))) return;

    // Bersihkan spam simbol (mis. @@@@) agar tidak dibaca aneh, tapi pertahankan @username
    msg = this.sanitizeForSpeech(msg);
    if (!msg) return;

    // Support multiple placeholder occurrences across template
    let text = this.template
      .replace(/{user}/gi, chatData.username || 'Seseorang')
      .replace(/{message}/gi, msg)
      .replace(/{platform}/gi, this.platformLabel(platform));

    // Bersihkan URL agar rapi
    text = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, 'sebuah tautan');

    this.queue.push(text);
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

  playNext() {
    if (this.isPlaying || this.queue.length === 0) return;

    this.isPlaying = true;
    const text = this.queue.shift();

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
      if (this.synth.speaking) this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance; // Retain reference to prevent Chromium GC freeze bug
      utterance.voice = this.selectedVoice;
      utterance.lang = 'id-ID';
      utterance.volume = Math.min(Math.max(this.volume, 0), 1);
      utterance.rate = Math.min(Math.max(this.rate, 0.5), 2);
      utterance.pitch = Math.min(Math.max(this.pitch, 0.5), 1.5);

      if (this.speechWatchdog) clearTimeout(this.speechWatchdog);

      const finish = () => {
        if (this.speechWatchdog) {
          clearTimeout(this.speechWatchdog);
          this.speechWatchdog = null;
        }
        this.currentUtterance = null;
        this.isPlaying = false;
        setTimeout(() => this.playNext(), 250);
      };

      utterance.onend = finish;
      utterance.onerror = (err) => {
        console.warn("[TTS] WebSpeech error, mencoba Online Audio fallback:", err);
        if (this.speechWatchdog) {
          clearTimeout(this.speechWatchdog);
          this.speechWatchdog = null;
        }
        this.currentUtterance = null;
        this.speakWithOnlineAudio(text);
      };

      // Watchdog timeout: unfreeze if browser speech thread hangs
      const maxDurationMs = Math.max(12000, text.length * 350);
      this.speechWatchdog = setTimeout(() => {
        if (this.isPlaying && this.currentUtterance === utterance) {
          console.warn("[TTS] SpeechSynthesis watchdog triggered (force finish).");
          finish();
        }
      }, maxDurationMs);

      this.synth.speak(utterance);
    } catch (e) {
      this.currentUtterance = null;
      this.speakWithOnlineAudio(text);
    }
  }

  speakWithOnlineAudio(text) {
    const cleanText = text.substring(0, 180);
    const url = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=id&q=${encodeURIComponent(cleanText)}`;

    const finish = () => {
      this.isPlaying = false;
      this.currentAudio = null;
      setTimeout(() => this.playNext(), 250);
    };

    try {
      if (this.currentAudio) {
        this.currentAudio.pause();
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
    if (this.speechWatchdog) {
      clearTimeout(this.speechWatchdog);
      this.speechWatchdog = null;
    }
    this.currentUtterance = null;
    if (this.synth) this.synth.cancel();
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }
}

window.MbakGoogleTTS = MbakGoogleTTS;