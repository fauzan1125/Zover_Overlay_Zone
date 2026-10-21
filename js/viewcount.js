/**
 * ViewCountMonitor
 * Memantau jumlah penonton live Kick, YouTube, dan TikTok via proxy lokal.
 */

function getLocalServerBase() {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) {
    return window.location.origin;
  }
  return 'http://localhost:8765';
}

class ViewCountMonitor {
  constructor() {
    this.enabled = true;
    this.platforms = { kick: true, youtube: true, tiktok: true };
    this.refreshMs = 30000;
    this.sources = { kickUsername: '', ytVideoInput: '', tiktokUsername: '' };
    this.counts = { kick: 0, youtube: 0, tiktok: 0 };

    this.proxyBase = `${getLocalServerBase()}/proxy`;
    this.labels = { tiktok: 'TikTok', youtube: 'YouTube', kick: 'Kick' };
    // Urutan tampilan bar sesuai desain: TikTok, YouTube, Kick
    this.order = ['tiktok', 'youtube', 'kick'];

    this.timer = null;
    this.lastPoll = 0;
    this.liveCount = null;
    this.lastLiveUpdate = 0;
    this.vcBroadcastChannel = null;
    this.vcStorageKey = 'chat_overlay_viewcount_sync';

    this.initSync();
    this.render();
    this.start();
    this.poll();
  }

  initSync() {
    try {
      this.vcBroadcastChannel = new BroadcastChannel('zover_viewcount_channel');
      this.vcBroadcastChannel.onmessage = (event) => {
        if (event.data && typeof event.data.tiktok === 'number') {
          this.liveCount = event.data.tiktok;
          this.lastLiveUpdate = Date.now();
          this.counts.tiktok = event.data.tiktok;
          this.render();
        }
      };
    } catch (e) {}

    window.addEventListener('storage', (e) => {
      if (e.key === this.vcStorageKey && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (typeof payload.tiktok === 'number') {
            this.liveCount = payload.tiktok;
            this.lastLiveUpdate = Date.now();
            this.counts.tiktok = payload.tiktok;
            this.render();
          }
        } catch (err) {}
      }
    });
  }

  setTikTokCount(count) {
    if (typeof count !== 'number' || isNaN(count)) return;
    this.liveCount = count;
    this.lastLiveUpdate = Date.now();
    this.counts.tiktok = count;
    this.render();

    const payload = { tiktok: count, timestamp: Date.now() };
    try {
      if (this.vcBroadcastChannel) {
        this.vcBroadcastChannel.postMessage(payload);
      }
    } catch (e) {}
    try {
      localStorage.setItem(this.vcStorageKey, JSON.stringify(payload));
    } catch (e) {}
  }

  // Terima potongan config dari Application (dashboard & overlay).
  updateConfig(cfg = {}) {
    const prevRefresh = this.refreshMs;
    if (cfg.enabled !== undefined) this.enabled = !!cfg.enabled;
    if (cfg.platforms) this.platforms = Object.assign({}, this.platforms, cfg.platforms);
    if (cfg.refreshMs) this.refreshMs = parseInt(cfg.refreshMs, 10) || 30000;
    if (cfg.kickUsername !== undefined) this.sources.kickUsername = cfg.kickUsername || '';
    if (cfg.ytVideoInput !== undefined) this.sources.ytVideoInput = cfg.ytVideoInput || '';
    if (cfg.tiktokUsername !== undefined) this.sources.tiktokUsername = cfg.tiktokUsername || '';

    if (prevRefresh !== this.refreshMs) this.start();
    this.render();

    // Poll segera bila sumber berubah, tapi dibatasi agar tidak membanjiri proxy
    if (Date.now() - this.lastPoll > 10000) this.poll();
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), this.refreshMs);
  }

  // Mode standalone (overlay_viewcount.html): sinkron config dari server lokal
  // tanpa memerlukan app.js / connector chat.
  attachConfigPolling(intervalMs = 5000) {
    const load = async () => {
      try {
        const res = await fetch(`${getLocalServerBase()}/api/config`, { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = await res.json();
        this.updateConfig({
          enabled: cfg.viewCountEnabled,
          platforms: cfg.viewCountPlatforms,
          refreshMs: (parseInt(cfg.viewCountRefresh, 10) || 30) * 1000,
          kickUsername: cfg.kickUsername,
          ytVideoInput: cfg.ytVideoInput,
          tiktokUsername: cfg.tiktokUsername
        });
      } catch (e) { /* server belum siap, coba lagi periode berikutnya */ }
    };
    load();
    setInterval(load, intervalMs);

    // Cross-process event bridge listener for OBS CEF
    let lastEventTimestamp = Date.now() - 2000;
    setInterval(async () => {
      try {
        const res = await fetch(`${getLocalServerBase()}/api/events?since=${lastEventTimestamp}`, { cache: 'no-store' });
        if (res.ok) {
          const events = await res.json();
          if (Array.isArray(events) && events.length > 0) {
            for (const evt of events) {
              if (evt.timestamp > lastEventTimestamp) lastEventTimestamp = evt.timestamp;
              if (evt.type === 'VIEWCOUNT_UPDATE' && evt.data && typeof evt.data.tiktok === 'number') {
                this.setTikTokCount(evt.data.tiktok);
              }
            }
          }
        }
      } catch (_) {}
    }, 500);
  }

  async poll() {
    this.lastPoll = Date.now();
    if (!this.enabled) { this.render(); return; }

    const tasks = [];
    if (this.platforms.kick && this.sources.kickUsername) {
      tasks.push(this.fetchKick().then(v => { if (v != null) this.counts.kick = v; }));
    }
    if (this.platforms.youtube && this.sources.ytVideoInput) {
      tasks.push(this.fetchYouTube().then(v => { if (v != null) this.counts.youtube = v; }));
    }
    if (this.platforms.tiktok && this.sources.tiktokUsername) {
      tasks.push(this.fetchTikTok().then(v => { if (v != null) this.counts.tiktok = v; }));
    }
    if (tasks.length) await Promise.all(tasks);
    this.render();
  }

  // ---------- Pengambilan data (best-effort via proxy lokal) ----------

  async proxyGet(url) {
    try {
      const res = await fetch(`${this.proxyBase}?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
      });
      if (!res.ok) return '';
      return await res.text();
    } catch (e) {
      return '';
    }
  }

  extractNumber(text, patterns) {
    if (!text) return null;
    for (const p of patterns) {
      const m = text.match(p);
      if (!m || m[1] == null) continue;
      const n = parseInt(String(m[1]).replace(/[^\d]/g, ''), 10);
      if (!isNaN(n)) return n;
    }
    return null;
  }

  async fetchKick() {
    const u = String(this.sources.kickUsername || '').trim().replace(/^@/, '').toLowerCase();
    if (!u) return null;
    // Coba endpoint API (JSON) dulu, fallback ke halaman channel
    const api = await this.proxyGet(`https://kick.com/api/v2/channels/${u}`);
    if (api) {
      try {
        const d = JSON.parse(api);
        if (d && d.livestream === null) return 0; // Streamer sedang offline
        const v = (d && d.livestream && (d.livestream.viewer_count ?? d.livestream.viewerCount)) ?? (d && d.viewers);
        if (typeof v === 'number') return v;
      } catch (e) { /* bukan JSON, lanjut fallback */ }
    }
    const html = await this.proxyGet(`https://kick.com/${u}`);
    if (!html) return null; // Network failure, keep last
    const count = this.extractNumber(html, [/"viewer_count"\s*:\s*(\d+)/, /"viewers"\s*:\s*(\d+)/]);
    return count != null ? count : 0;
  }

  async fetchYouTube() {
    const ids = this.parseYtIds(this.sources.ytVideoInput);
    if (!ids.length) return null;
    let total = 0;
    let anySuccess = false;
    for (const id of ids) {
      const html = await this.proxyGet(`https://www.youtube.com/watch?v=${id}`);
      if (html) {
        anySuccess = true;
        // "watching"/"penonton" = penonton concurrent live; pola viewCount polos
        // adalah total views seumur hidup video, jadi dicoba belakangan
        const v = this.extractNumber(html, [
          /"viewCount"\s*:\s*\{\s*"simpleText"\s*:\s*"([\d.,\s]+)\s(?:watching|penonton)"/,
          /"viewCount"\s*:\s*"(\d+)"/,
          /"viewCount"\s*:\s*(\d+)/
        ]);
        if (v != null) { total += v; }
      }
    }
    return anySuccess ? total : null;
  }

  async fetchTikTok() {
    // TikTok web /live page blocks raw proxy scraping; preserve WebSocket roomUser count
    if (this.liveCount != null) {
      return this.liveCount;
    }
    return null;
  }

  parseYtIds(input) {
    const out = [];
    String(input || '').split(/[\s,;]+/).filter(Boolean).forEach(tok => {
      let id = null;
      if (/^[a-zA-Z0-9_-]{11}$/.test(tok)) id = tok;
      else {
        const m = tok.match(/(?:v=|v\/|embed\/|live\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
        if (m) id = m[1];
      }
      if (id && !out.includes(id)) out.push(id);
    });
    return out;
  }

  // ---------- Render bar ----------

  render() {
    const bar = document.getElementById('viewcount-bar');
    if (!bar) return;

    const active = this.enabled ? this.order.filter(p => this.platforms[p]) : [];
    bar.textContent = '';
    if (!active.length) {
      bar.style.display = 'none';
      return;
    }

    // Bangun via DOM + textContent (aman, tanpa innerHTML)
    bar.style.display = 'flex';
    active.forEach(p => {
      const item = document.createElement('span');
      item.className = `viewcount-item ${p}`;

      const label = document.createElement('span');
      label.textContent = `${this.labels[p]} Views: `;
      item.appendChild(label);

      const num = document.createElement('b');
      num.textContent = String(this.counts[p] || 0);
      item.appendChild(num);

      bar.appendChild(item);
    });
  }
}

window.ViewCountMonitor = ViewCountMonitor;
