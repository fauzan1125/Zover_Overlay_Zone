# ZoVer Live Overlay Engine: Bug Fix Patch & Migration Blueprint (v3.0)

Dokumen ini merangkum tindakan perbaikan cepat (*hotfix*) untuk bug operasional pada versi Node.js saat ini, serta rencana arsitektur lengkap migrasi ke **Rust Core + Sidecar** beserta sistem packaging installer dan auto-update.

---

## Bagian 1: Perbaikan Bug Mendesak (Patch Versi Saat Ini)

Sebelum melakukan refaktorisasi penuh ke Rust, selesaikan 5 masalah utama yang terjadi saat live streaming pada codebase saat ini:

### 1. Fix Suara TTS Dobel Saat Refresh & Close App (`js/tts.js` & `server.js`)
* **Akar Masalah:** Koneksi socket hantu (*zombie connection*) pada status TCP `TIME_WAIT` saat OBS Browser Source di-refresh, atau tab lama tetap bertahan saat `.exe` ditutup.
* **Solusi Frontend (`js/tts.js`):**
  1. **BroadcastChannel Tab Killer:** Gunakan `BroadcastChannel` antar-tab untuk mematikan socket dan suara di tab lama setiap kali tab OBS baru dimuat.
  2. **FIFO Audio Queue & Deduplikasi ID:** Masukkan audio ke antrean serial (diputar satu per satu berdasarkan event `onend`) dan tolak ID pesan yang sama.
  3. **Unload Cleanup:** Panggil `window.speechSynthesis.cancel()` pada event `beforeunload`.

```javascript
// Implementasi inti pada js/tts.js
const zoverTabChannel = new BroadcastChannel('zover_tts_channel');
zoverTabChannel.postMessage({ type: 'NEW_TAB_ACTIVE' });

zoverTabChannel.onmessage = (e) => {
  if (e.data.type === 'NEW_TAB_ACTIVE') {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (window.ws) window.ws.close();
  }
};

const playedTTSIds = new Set();
const ttsQueue = [];
let isSpeaking = false;

function enqueueTTS(data) {
  const msgId = data.id || `${data.user}_${data.message}_${Math.floor(Date.now() / 2000)}`;
  if (playedTTSIds.has(msgId)) return;
  
  playedTTSIds.add(msgId);
  if (playedTTSIds.size > 100) {
    playedTTSIds.delete(playedTTSIds.values().next().value);
  }

  ttsQueue.push(data);
  processTTSQueue();
}

function processTTSQueue() {
  if (isSpeaking || ttsQueue.length === 0) return;
  isSpeaking = true;
  const current = ttsQueue.shift();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(current.message);
    utterance.lang = 'id-ID';
    utterance.onend = () => { isSpeaking = false; processTTSQueue(); };
    utterance.onerror = () => { isSpeaking = false; processTTSQueue(); };
    window.speechSynthesis.speak(utterance);
  }
}

window.addEventListener('beforeunload', () => {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
});
```

* **Solusi Server (`server.js`):**
  Kunci listener server secara eksplisit ke IPv4 `127.0.0.1` dan kirim frame WebSocket `Close (1000)` sebelum aplikasi dimatikan.

```javascript
server.listen(8765, '127.0.0.1');

process.on('SIGINT', () => {
  wss.clients.forEach((client) => client.close(1000, 'Server Shutdown'));
  process.exit(0);
});
```

---

### 2. Fix Alert Like TikTok Tidak Muncul (`js/connectors/tiktok.js` & `js/alerts.js`)
* **Akar Masalah:** TikTok mengirimkan event `like` dalam bentuk paket akumulasi (`likeCount`), bukan event tunggal seperti `follow`.
* **Solusi:** Pastikan mapping properti pada `tiktokConnection.on('like')` mengirim field yang dikenali oleh `js/alerts.js`.

```javascript
tiktokConnection.on('like', (data) => {
  broadcastEvent({
    platform: 'tiktok',
    type: 'like',
    id: `tt_like_${data.userId}_${Date.now()}`,
    user: data.uniqueId || data.nickname || 'Viewer',
    avatar: data.profilePictureUrl,
    likeCount: data.likeCount || 1,
    totalLikeCount: data.totalLikeCount || 0
  });
});
```

---

### 3. Fix TikTok Putus Setelah Beberapa Jam & Dobel Saat Reconnect (`js/connectors/tiktok.js`)
* **Akar Masalah:** Saat auto-reconnect berjalan, event listener dari koneksi sebelumnya belum dihapus (`removeAllListeners`), menyebabkan listener menumpuk di memori.
* **Solusi:** Selalu bersihkan seluruh listener dan instance koneksi lama sebelum memulai koneksi ulang.

```javascript
let tiktokConnection = null;
let reconnectTimer = null;

async function startTikTok(username) {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (tiktokConnection) {
    try {
      tiktokConnection.removeAllListeners();
      await tiktokConnection.disconnect();
    } catch (err) {}
    tiktokConnection = null;
  }

  tiktokConnection = new WebcastPushConnection(username, {
    enableExtendedGiftInfo: true
  });

  attachListeners(tiktokConnection);

  tiktokConnection.on('disconnected', () => {
    reconnectTimer = setTimeout(() => startTikTok(username), 8000);
  });

  try {
    await tiktokConnection.connect();
  } catch (e) {
    reconnectTimer = setTimeout(() => startTikTok(username), 10000);
  }
}
```

---

### 4. Fix Viewcount TikTok Macet (`js/connectors/tiktok.js` & `js/viewcount.js`)
* **Akar Masalah:** Nama properti statistik viewer pada event `roomUser` berubah-ubah (`viewerCount` vs `totalUser`), dan paket WebSocket sering di-throttle oleh TikTok.
* **Solusi:** Gunakan pembacaan multi-properti ditambah HTTP polling cadangan setiap 15 detik.

```javascript
let viewerPollInterval = null;

function setupViewcountTracker(tiktokConnection, broadcastFn) {
  tiktokConnection.on('roomUser', (data) => {
    const count = data.viewerCount ?? data.totalUser ?? data.userCount ??
      (Array.isArray(data.topViewers) ? data.topViewers.length : null);

    if (typeof count === 'number') {
      broadcastFn({ platform: 'tiktok', type: 'viewcount', count });
    }
  });

  if (viewerPollInterval) clearInterval(viewerPollInterval);
  viewerPollInterval = setInterval(async () => {
    try {
      const roomInfo = await tiktokConnection.getRoomInfo();
      const liveCount = roomInfo?.user_count ?? roomInfo?.stats?.total_user ?? roomInfo?.viewer_count;
      if (typeof liveCount === 'number') {
        broadcastFn({ platform: 'tiktok', type: 'viewcount', count: liveCount });
      }
    } catch (err) {}
  }, 15000);
}
```

---

### 5. Fix Overlay Hilang di Scene Gameplay OBS Studio
* **Konfigurasi Wajib di OBS:**
  1. Gunakan metode **"Add Existing"** saat memasang source `overlay_chalert` ke scene kedua (jangan buat source baru dengan URL sama).
  2. Klik kanan source -> **Properties** -> **Matikan centang** pada *"Shutdown source when not visible"* dan *"Refresh browser when scene becomes active"*.
  3. Pastikan urutan layer `overlay_chalert` berada di posisi paling atas di atas Game Capture.

---

## Bagian 2: Arsitektur Baru ZoVer v3.0 (Rust Core + Sidecar)

### 2.1 Diagram Alur Sistem

```text
[ YouTube Live ] ──(Native Rust Poller)───────┐
[ Kick Live ]    ──(Native Rust Pusher WS)────┼──► ┌─────────────────────────┐
[ TikTok Live ]  ──(Node.js Sidecar Worker)───┘    │   ZoVer Core (Rust)     │
                                                   │  (Axum + Tokio Hub)     │
                                                   │  Port: 127.0.0.1:8765   │
                                                   └────────────┬────────────┘
                                                                │
                                        ┌───────────────────────┴───────────────────────┐
                                        ▼                                               ▼
                         ┌─────────────────────────────┐                 ┌─────────────────────────────┐
                         │     OBS Browser Source      │                 │     Dashboard Pengaturan    │
                         │  (Embedded HTML/CSS/JS)     │                 │        (index.html)         │
                         └─────────────────────────────┘                 └─────────────────────────────┘
```

### 2.2 Struktur Proyek Target

```text
zover-rust/
├── Cargo.toml                      # Dependensi Rust & profile optimasi release
├── config.json                     # Pengaturan eksternal pengguna
├── src/
│   ├── main.rs                     # Entry point Axum, IPv4 bind, & rust-embed
│   ├── ws_hub.rs                   # Tokio Broadcast Hub & anti-zombie teardown
│   ├── sidecar_manager.rs          # Pengelola child-process worker TikTok
│   ├── updater.rs                  # Cek rilis & self-update via GitHub API
│   └── connectors/
│       ├── kick.rs                 # Konektor native Kick
│       └── youtube.rs              # Konektor native YouTube
├── web/                            # DI-EMBED LANGSUNG KE BINARY .EXE
│   ├── index.html
│   ├── overlay_alert.html
│   ├── overlay_chalert.html
│   ├── overlay_chat.html
│   ├── overlay_running_text.html
│   ├── overlay_viewcount.html
│   ├── css/
│   ├── js/
│   ├── logo_platform/
│   └── media/
├── sidecar/
│   └── tiktok_worker.js            # Worker khusus scraping TikTok Live
└── installer/
    └── zover_setup.iss             # Konfigurasi Inno Setup Wizard
```

---

## Bagian 3: Distribusi Installer & Auto-Update

### 3.1 Packaging Windows Installer (`Inno Setup`)
* Mengemas `zover.exe`, worker biner ringan, dan template `config.example.json` menjadi satu wizard installer **`ZoVer_Setup.exe`**.
* **Proteksi Konfigurasi:** Flag `onlyifdoesntexist` pada `config.json` mencegah settingan pengguna tertimpa saat memperbarui versi aplikasi.
* **Seamless Replacement:** Flag `CloseApplications=yes` menutup proses `zover.exe` lama secara otomatis sebelum menimpanya dengan versi baru.

### 3.2 In-App Self-Updater & CI/CD Pipeline
* **Pengecekan & Update Mandiri:** Menggunakan crate `self_update` yang terhubung ke GitHub Releases API untuk mendeteksi tag rilis baru, menampilkan modal notifikasi di dashboard, serta mengunduh dan mengganti file `.exe` dalam satu klik.
* **Otomatisasi Build:** Menggunakan **GitHub Actions** untuk melakukan compile Rust, menyusun installer Inno Setup, dan menerbitkan rilis secara otomatis setiap kali tag versi baru (`v*`) di-push ke repositori.