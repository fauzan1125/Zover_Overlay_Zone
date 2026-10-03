/**
 * YouTube Live Chat Connector (Local Proxy + API Mode, MULTI-LIVE Edition)
 * Mendukung BEBERAPA live sekaligus (mis. stream portrait + landscape).
 * Tempel beberapa URL / Video ID dalam satu kolom, pisahkan dengan koma, spasi, atau enter.
 * Uses local PowerShell proxy server (http://localhost:8765/proxy) to bypass CORS,
 * or YouTube Data API v3 if an API key is provided.
 */

class YouTubeConnector {
  constructor(onMessageCallback, onStatusCallback, onAlertCallback) {
    this.onMessage = onMessageCallback;
    this.onStatus = onStatusCallback;
    this.onAlert = onAlertCallback;
    this.videoInput = '';
    this.videoIds = [];   // array of video IDs (multi-live)
    this.states = {};     // per-video state: { continuation, liveChatId, nextPageToken, failCount }
    this.apiKey = '';
    this.pollTimer = null;
    this.isPolling = false;
    this.seenMessageIds = new Set();
    this.localProxyBase = 'http://localhost:8765/proxy';
  }

  getTimeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      try { return AbortSignal.timeout(ms); } catch (e) {}
    }
    return undefined;
  }

  extractVideoId(input) {
    if (!input) return null;
    const str = input.trim();

    if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;

    const match = str.match(/(?:v=|v\/|embed\/|live\/|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) return match[1];

    return null;
  }

  // Parse satu kolom input menjadi daftar video ID unik (dukung multi-live)
  extractVideoIds(input) {
    if (!input) return [];
    const tokens = String(input).split(/[\s,;]+/).filter(Boolean);
    const ids = [];
    tokens.forEach(tok => {
      const id = this.extractVideoId(tok);
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }

  async connect(videoInput, apiKey = '') {
    this.disconnect();

    this.videoInput = videoInput ? videoInput.trim() : '';
    this.apiKey = apiKey.trim();
    this.videoIds = this.extractVideoIds(this.videoInput);

    if (this.videoIds.length === 0) {
      this.updateStatus('disconnected', 'Video ID tidak valid. Masukkan satu atau beberapa URL/Video ID YouTube Live (pisahkan dengan koma/enter).');
      return;
    }

    // Init state per-video
    this.states = {};
    this.videoIds.forEach(id => {
      this.states[id] = { continuation: null, liveChatId: null, nextPageToken: null, failCount: 0 };
    });

    const label = this.videoIds.length > 1 ? `${this.videoIds.length} live` : this.videoIds[0];
    this.updateStatus('connecting', `Menghubungkan ke YouTube Live (${label})...`);

    if (this.apiKey) {
      await this.initApiMode();
    } else {
      await this.initProxyScraperMode();
    }
  }

  // API Mode with YouTube Data API Key
  async initApiMode() {
    try {
      const idsParam = this.videoIds.join(',');
      const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${idsParam}&key=${this.apiKey}`;
      const res = await fetch(url);
      const data = await res.json();

      let found = 0;
      if (data.items) {
        data.items.forEach(item => {
          const st = this.states[item.id];
          const chatId = item.liveStreamingDetails?.activeLiveChatId;
          if (st && chatId) {
            st.liveChatId = chatId;
            found++;
          }
        });
      }

      if (found > 0) {
        this.isPolling = true;
        this.updateStatus('connected', `Terhubung ke YouTube Live Chat (API Mode, ${found} live)`);
        this.pollApiMessages();
        return;
      }
      throw new Error('Live Chat ID tidak ditemukan.');
    } catch (err) {
      console.warn('[YouTube API Error] Falling back to Proxy Scraper:', err);
      await this.initProxyScraperMode();
    }
  }

  async pollApiMessages() {
    if (!this.isPolling) return;

    const active = this.videoIds.filter(id => this.states[id] && this.states[id].liveChatId);
    if (active.length === 0) {
      this.pollTimer = setTimeout(() => this.pollApiMessages(), 4000);
      return;
    }

    let minInterval = 4000;
    await Promise.all(active.map(async (id) => {
      const st = this.states[id];
      let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${st.liveChatId}&part=snippet,authorDetails&key=${this.apiKey}`;
      if (st.nextPageToken) url += `&pageToken=${st.nextPageToken}`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.items) {
          data.items.forEach(item => {
            if (this.seenMessageIds.has(item.id)) return;
            this.seenMessageIds.add(item.id);

            const chatData = {
              id: item.id,
              platform: 'youtube',
              username: item.authorDetails?.displayName || 'YTUser',
              userColor: item.authorDetails?.isChatOwner ? '#FFD700' : '#FF3333',
              message: item.snippet?.displayMessage || item.snippet?.textMessageDetails?.messageText || '',
              avatar: item.authorDetails?.profileImageUrl || 'https://www.youtube.com/favicon.ico',
              badges: [],
              timestamp: new Date(item.snippet?.publishedAt)
            };

            if (this.onMessage && chatData.message) this.onMessage(chatData);
          });

          st.nextPageToken = data.nextPageToken;
          const interval = Math.max(data.pollingIntervalMillis || 3000, 2000);
          if (interval < minInterval) minInterval = interval;
        }
      } catch (err) {
        // abaikan error per-video, poll berikutnya akan mencoba lagi
      }
    }));

    this.trimSeenIds();
    if (this.isPolling) {
      this.pollTimer = setTimeout(() => this.pollApiMessages(), minInterval);
    }
  }

  // Proxy Scraper Mode via local server
  async initProxyScraperMode() {
    const proxyAvailable = await this.testLocalProxy();

    if (!proxyAvailable) {
      this.updateStatus('disconnected',
        '⚠️ Server lokal belum jalan! Jalankan server.ps1 dulu: klik kanan > Run with PowerShell');
      return;
    }

    this.isPolling = true;

    // Fetch initial live_chat pages (paralel) untuk mendapat continuation token tiap live
    await Promise.all(this.videoIds.map(id => this.fetchInitialChatPage(id)));

    const label = this.videoIds.length > 1 ? `${this.videoIds.length} live` : this.videoIds[0];
    this.updateStatus('connected', `Terhubung ke YouTube Live (${label})`);
    this.pollProxyMessages();
  }

  async testLocalProxy() {
    try {
      const testUrl = `${this.localProxyBase}?url=${encodeURIComponent('https://www.youtube.com/robots.txt')}`;
      const res = await fetch(testUrl, { signal: this.getTimeoutSignal(3000) });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async fetchInitialChatPage(videoId) {
    try {
      const chatUrl = `https://www.youtube.com/live_chat?v=${videoId}`;
      const proxyUrl = `${this.localProxyBase}?url=${encodeURIComponent(chatUrl)}`;
      const res = await fetch(proxyUrl, { signal: this.getTimeoutSignal(10000) });
      const html = await res.text();

      if (html && html.length > 1000) {
        const st = this.states[videoId];
        const contMatch = html.match(/"continuation"\s*:\s*"([^"]+)"/);
        if (st && contMatch && contMatch[1]) {
          st.continuation = contMatch[1];
        }
        this.parseLiveChatHtml(html);
        return true;
      }
    } catch (e) {
      console.warn('[YouTube] Initial chat page fetch failed:', e);
    }
    return false;
  }

  async pollProxyMessages() {
    if (!this.isPolling || this.videoIds.length === 0) return;

    await Promise.all(this.videoIds.map(id => this.pollOneVideo(id)));

    if (this.isPolling) {
      // Adaptive polling: slow down on errors, speed up on success
      const maxFail = Math.max(...this.videoIds.map(id => this.states[id] ? this.states[id].failCount : 0));
      const interval = maxFail > 3 ? 6000 : 2500;
      this.pollTimer = setTimeout(() => this.pollProxyMessages(), interval);
    }
  }

  async pollOneVideo(videoId) {
    const st = this.states[videoId];
    if (!st) return false;

    try {
      if (st.continuation) {
        // Use InnerTube continuation endpoint for real-time updates
        const jsonStr = await this.fetchWithContinuation(st.continuation);
        if (jsonStr && jsonStr.length > 50) {
          try {
            const ytData = JSON.parse(jsonStr);
            this.parseLiveChatJson(ytData);

            const continuations = ytData.continuationContents?.liveChatContinuation?.continuations;
            if (continuations && continuations.length > 0) {
              const nextCont = continuations[0].invalidationContinuationData?.continuation ||
                               continuations[0].timedContinuationData?.continuation;
              if (nextCont) st.continuation = nextCont;
            }
            st.failCount = 0;
            return true;
          } catch (e) {
            console.warn('[YouTube] Failed to parse InnerTube JSON', e);
          }
        }
      }

      // Fallback: re-fetch the full live_chat page
      const chatUrl = `https://www.youtube.com/live_chat?v=${videoId}&_t=${Date.now()}`;
      const proxyUrl = `${this.localProxyBase}?url=${encodeURIComponent(chatUrl)}`;
      const res = await fetch(proxyUrl, { signal: this.getTimeoutSignal(10000) });
      const html = await res.text();

      if (html && html.length > 500) {
        this.parseLiveChatHtml(html);
        st.failCount = 0;

        const contMatch = html.match(/"continuation"\s*:\s*"([^"]+)"/);
        if (contMatch && contMatch[1]) st.continuation = contMatch[1];
        return true;
      } else {
        st.failCount++;
        return false;
      }
    } catch (e) {
      st.failCount++;
      console.warn('[YouTube Proxy Poll Error]', e);
      return false;
    }
  }

  async fetchWithContinuation(continuation) {
    try {
      const innerTubeUrl = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false';
      const bodyPayload = JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00'
          }
        },
        continuation: continuation
      });

      const proxyUrl = `${this.localProxyBase}?url=${encodeURIComponent(innerTubeUrl)}`;

      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: bodyPayload,
        signal: this.getTimeoutSignal(10000)
      });

      const htmlOrJson = await res.text();
      return htmlOrJson;
    } catch (e) {
      console.warn('[YouTube] InnerTube fetch failed:', e);
      return '';
    }
  }

  parseLiveChatJson(ytData) {
    let foundAny = false;
    try {
      const actions = ytData.contents?.liveChatRenderer?.actions ||
                      ytData.continuationContents?.liveChatContinuation?.actions;

      if (actions && Array.isArray(actions)) {
        actions.forEach(act => {
          const renderer = act.addChatItemAction?.item;
          if (!renderer) return;

          // EVENT: YOUTUBE SUBSCRIPTION / MEMBERSHIP
          const memberItem = renderer.liveChatMembershipItemRenderer || renderer.liveChatSponsorMessageRenderer || renderer.liveChatSubAnnouncementRenderer;
          if (memberItem) {
            const subName = memberItem.authorName?.simpleText || 'YouTube Viewer';
            if (this.onAlert) {
              this.onAlert({
                type: 'yt_sub',
                platform: 'youtube',
                user: subName
              });
            }
          }

          const item = renderer.liveChatTextMessageRenderer || renderer.liveChatPaidMessageRenderer;
          if (item && this.processChatItem(item)) foundAny = true;
        });
      }
    } catch (err) {
      console.warn('[YouTube JSON Parse Error]', err);
    }
    return foundAny;
  }

  parseLiveChatHtml(html) {
    if (!html) return false;
    let foundAny = false;

    // Try structured JSON Parse via ytInitialData
    try {
      const match = html.match(/window\["ytInitialData"\]\s*=\s*({.*?});/s) ||
                    html.match(/var ytInitialData\s*=\s*({.*?});/s) ||
                    html.match(/ytInitialData\s*=\s*({.*?});/s);
      if (match && match[1]) {
        const ytData = JSON.parse(match[1]);
        if (this.parseLiveChatJson(ytData)) foundAny = true;
      }
    } catch (err) {
      console.warn('[YouTube Parse Error]', err);
    }

    // Try raw regex fallback if JSON parse failed
    if (!foundAny) {
      try {
        const regex = /"(?:liveChatTextMessageRenderer|liveChatPaidMessageRenderer)"\s*:\s*(\{.*?"id"\s*:\s*"[^"]+".*?\})/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
          try {
            const item = JSON.parse(m[1]);
            if (this.processChatItem(item)) foundAny = true;
          } catch (e) {}
        }
      } catch (e) {}
    }

    return foundAny;
  }

  processChatItem(item) {
    if (!item || !item.id) return false;

    const id = item.id;
    if (this.seenMessageIds.has(id)) return false;
    this.seenMessageIds.add(id);

    const username = item.authorName?.simpleText || 'YouTube Viewer';
    const donationAmount = item.purchaseAmountText?.simpleText || '';
    const userText = item.message?.runs?.map(r => {
      if (r.text) return r.text;
      if (r.emoji) {
        return r.emoji.shortcuts?.[0] || r.emoji.searchTerms?.[0] || r.emoji.image?.accessibility?.accessibilityData?.label || '';
      }
      return '';
    }).join('') || '';

    let message = '';
    if (donationAmount && userText) {
      message = `[${donationAmount}] ${userText}`;
    } else {
      message = donationAmount || userText;
    }
    const avatar = item.authorPhoto?.thumbnails?.[0]?.url || 'https://www.youtube.com/favicon.ico';

    if (message) {
      const chatData = {
        id,
        platform: 'youtube',
        username,
        userColor: '#ff3333',
        message,
        avatar,
        badges: [],
        timestamp: new Date()
      };

      if (this.onMessage) this.onMessage(chatData);
      return true;
    }
    return false;
  }

  trimSeenIds() {
    if (this.seenMessageIds.size > 500) {
      this.seenMessageIds = new Set(Array.from(this.seenMessageIds).slice(-200));
    }
  }

  disconnect() {
    this.isPolling = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.videoIds = [];
    this.states = {};
    this.seenMessageIds = new Set();
    this.updateStatus('disconnected', 'Terputus dari YouTube');
  }

  updateStatus(state, message) {
    if (this.onStatus) {
      this.onStatus({ platform: 'youtube', state, message });
    }
  }
}

window.YouTubeConnector = YouTubeConnector;
