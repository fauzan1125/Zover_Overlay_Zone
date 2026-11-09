# ZoVer Engine v3.0 Architecture Specification

**Document Type:** PRD, ERD/DFD, & R&D Technical Blueprint

**Target Environment:** Rust Core (Axum + Tokio) + Ingestion Sidecar

**Target Distribution:** Windows Single Executable / Inno Setup Installer

## 1. Product Requirement Document (PRD)

### 1.1 Executive Summary & Problem Statements

ZoVer (*Zover Overlay Zone*) adalah agregator live stream overlay multi-platform (YouTube, Kick, TikTok) yang menyajikan widget chatbox, dynamic alert, viewer counter, running text, soundboard, dan text-to-speech (TTS) langsung ke OBS Browser Source.

Pada versi sebelumnya (Node.js engine), terdapat beberapa bottleneck arsitektur:

1. **Double Audio Bug pada TTS:** Terjadi audio tabrakan atau pembacaan pesan ganda saat OBS Browser Source di-refresh, dipicu oleh penumpukan koneksi socket hantu (*zombie connection*) dan tidak adanya sistem antrean serial.

2. **TCP Socket Leak di Jaringan Loopback:** Dual-stack binding (`localhost` ambigu antara IPv4 `127.0.0.1` dan IPv6 `::1`) menyebabkan socket lama bertahan dalam status `TIME_WAIT` saat client melakukan refresh.

3. **Overhead Distribusi:** Memerlukan Node.js runtime utuh, folder `node_modules` besar, serta peluncuran berbasis script `.bat` yang rentan tertekan atau tertutup tanpa sengaja oleh pengguna.

### 1.2 Tujuan Pembaruan (Goals)

* **Zero Ghost Connection:** Menghilangkan 100% bug audio dobel melalui mekanisme tearing-down socket seketika di layer TCP loopback dan circular deduplication di frontend.

* **Ultra-Lightweight Footprint:** Konsumsi RAM saat idle $\le 25\text{ MB}$ dan latensi transmisi event lokal $< 1\text{ ms}$.

* **Single Executable Deployment:** Seluruh antarmuka web, overlay canvas, file CSS, sound alert, dan script client di-embed langsung ke dalam biner eksekusi tunggal `.exe`.

* **Standard Windows Installer:** Menyediakan file installer mandiri (`Setup.exe`) sekali klik yang siap dipasang di komputer streamer mana pun tanpa dependensi instalasi manual.

### 1.3 Kebutuhan Fungsional (Functional Requirements)

* **FR-01 (Single Binary Static Serving):** Engine Rust wajib menyajikan seluruh rute web (`/`, `/overlay_chat.html`, `/overlay_alert.html`, dll.) dan aset statis (`css/`, `js/`, `media/`) langsung dari memori biner menggunakan abstraksi `rust-embed`.

* **FR-02 (Strict IPv4 Binding):** Server wajib mengunci binding TCP pada `127.0.0.1:8765`, menonaktifkan fallback dual-stack untuk menghindari tabrakan rute loopback.

* **FR-03 (Anti-Zombie WebSocket Manager):** Memanfaatkan model channel broadcast non-blocking. Saat frame `Close` atau error drop TCP terdeteksi, subscriber socket wajib didrop seketika dari RAM.

* **FR-04 (Event Ingestion Pipeline):**

  * Konektor Kick dan YouTube dijalankan langsung (*native*) di dalam thread pool Rust.

  * Konektor TikTok ditangani oleh worker sidecar Node.js terisolasi yang mengirim payload via WebSocket internal di `/api/worker/tiktok`.

* **FR-05 (Deterministic FIFO Audio Queue):** Modul audio di frontend wajib menampung setiap event TTS dalam antrean berurutan (First-In, First-Out) dan mengunci pemutaran pesan berikutnya sampai pesan aktif selesai diputar (`onended`).

* **FR-06 (Event Deduplication):** Setiap payload event wajib memiliki identifier unik (UUIDv4). Client menolak memproses ulang pesan dengan UUID yang sama dalam jendela retensi waktu 60 detik.

### 1.4 Kebutuhan Non-Fungsional (Non-Functional Requirements)

* **CPU & RAM:** Penggunaan CPU mendekati $0\%$ saat idle; alokasi RAM biner $\le 30\text{ MB}$.

* **Background Execution:** Binary berjalan tanpa menampilkan jendela console Command Prompt Windows (`#![windows_subsystem = "windows"]`).

* **Reliability:** Jika worker sidecar TikTok mengalami kegagalan proses (crash), engine utama ZoVer dan overlay OBS tetap berjalan normal dengan sistem auto-restart backoff.

## 2. Entity-Relationship & Data Flow Architecture (ERD / DFD)

ZoVer beroperasi menggunakan state in-memory yang digerakkan oleh event asynchronous. Diagram berikut memetakan entitas data dan aliran pesan dari sumber platform hingga OBS Browser Source.

### 2.1 Entity Relationship Diagram (In-Memory State Model)

```
 ┌────────────────────────────────────────┐
 │              StreamEvent               │
 ├────────────────────────────────────────┤
 │ PK  id             : Uuid              │
 │     platform       : EventPlatform     │
 │     event_type     : EventType         │
 │     sender_name    : String            │
 │     content        : String            │
 │     timestamp      : u64               │
 │     metadata       : JsonValue         │
 └───────────────────┬────────────────────┘
                     │
                     │ 1:N
                     ▼
 ┌────────────────────────────────────────┐         1:1         ┌────────────────────────────────────────┐
 │             AudioQueueItem             │ ─────────────────── │           PlaybackLockState            │
 ├────────────────────────────────────────┤                     ├────────────────────────────────────────┤
 │ PK  queue_id       : Uuid              │                     │ PK  lock_id          : Uuid            │
 │ FK  event_id       : Uuid              │                     │     is_locked        : Boolean         │
 │     audio_payload  : AudioSource       │                     │     active_event_id  : Option<Uuid>    │
 │     enqueued_at    : u64               │                     │     locked_at        : u64             │
 │     status         : QueueStatus       │                     └────────────────────────────────────────┘
 └────────────────────────────────────────┘

```

#### Kamus Data Entitas:

1. **`StreamEvent`**:

   * `id`: UUID unik yang dibuat oleh Rust Core pada saat event pertama kali diterima.

   * `platform`: Enum (`YouTube`, `Kick`, `TikTok`, `System`).

   * `event_type`: Enum (`Chat`, `Gift`, `Alert`, `Tts`, `ViewCount`).

   * `sender_name`: Identitas pengirim chat / donatur.

   * `content`: Teks utama yang akan ditampilkan pada widget overlay dan dibaca oleh TTS.

   * `metadata`: Data opsional (level membership, nilai koin/gift, URL avatar profil).

2. **`AudioQueueItem`**:

   * Representasi antrean di sisi browser client (`tts.js`).

   * `status`: Enum (`Pending`, `Playing`, `Finished`, `Skipped`).

3. **`PlaybackLockState`**:

   * Mutex state di layer JavaScript client untuk menjamin audio diputar secara serial satu per satu.

### 2.2 Data Flow Diagram (DFD Level-1)

```
[ YouTube Live API ] ──(Reqwest Polling)────┐
                                             │
[ Kick Pusher WS ]   ──(Tungstenite Stream)─┼──► ┌────────────────────────────────┐
                                             │   │     Rust Ingestion Engine      │
[ TikTok Live ]      ──(Scraper Library)────┘   │   (Normalize & Stamp UUID)     │
       │                                         └───────────────┬────────────────┘
       ▼ (Node.js Sidecar)                                       │
  (Internal WS: /api/worker) ────────────────────────────────────┘
                                                                 │
                                                                 ▼
                                                 ┌────────────────────────────────┐
                                                 │      Tokio Broadcast Hub       │
                                                 │     (Port 127.0.0.1:8765)      │
                                                 └───────────────┬────────────────┘
                                                                 │
                                     ┌───────────────────────────┴───────────────────────────┐
                                     │ Broadcast Stream (ws://127.0.0.1:8765/ws)             │
                                     ▼                                                       ▼
                      ┌─────────────────────────────┐                         ┌─────────────────────────────┐
                      │     OBS Browser Source      │                         │     Dashboard Pengaturan    │
                      │  (overlay_*.html + tts.js)  │                         │        (index.html)         │
                      ├─────────────────────────────┤                         ├─────────────────────────────┤
                      │ • Cek Cache Deduplikasi ID  │                         │ • Monitoring Status Koneksi │
                      │ • Push ke FIFO Audio Queue  │                         │ • Simulasi Event & Test TTS │
                      │ • Eksekusi Serial Audio     │                         │ • Konfigurasi Nilai Alert   │
                      └─────────────────────────────┘                         └─────────────────────────────┘

```

## 3. Research & Development (R&D) Technical Blueprint

### 3.1 Analisis & Solusi Akar Masalah Double TTS

* **Penyebab Utama:**
  Ketika browser source OBS di-refresh, frame window CEF (Chromium Embedded Framework) memuat ulang instance JavaScript baru, namun soket TCP lama belum menyelesaikan tahapan handshake `FIN-ACK` dan masih bertahan di status `TIME_WAIT`. Server Node.js sebelumnya tetap mengirimkan payload broadcast ke soket lama dan soket baru. Di saat bersamaan, antrean Web Speech API bawaan browser tidak dibersihkan sehingga mengeksekusi buffer lama dan baru secara bertumpuk.

* **Solusi Multi-Layer:**

  1. **Layer Transport (Rust Axum):** Menghindari penyimpanan array client manual. Memanfaatkan `tokio::sync::broadcast` yang dipadukan dengan loop `tokio::select!`. Saat client me-refresh, write failure langsung terpicu seketika dan task subscriber lama langsung di-`abort()` tanpa menunggu timeout TCP.

  2. **Layer Client Lifecycle (JavaScript):** Menangkap event `beforeunload` pada browser source OBS untuk memanggil `window.speechSynthesis.cancel()` dan menutup koneksi socket secara eksplisit sebelum instance dihancurkan.

  3. **Layer Deduplikasi (In-Memory Set):** Client menyimpan 100 UUID pesan terakhir ke dalam struktur data `Set`. Jika paket dengan UUID identik diterima kembali, paket langsung diabaikan sebelum menyentuh antrean audio.

### 3.2 Pola Arsitektur Hybrid Sidecar

* **Kebutuhan:** Protobuf signature pada TikTok Live Webcast kerap berubah sewaktu-waktu. Ekosistem Node.js memiliki pustaka reverse engineering yang diperbarui secara berkala oleh komunitas.

* **Implementasi:**

  * Rust Core menjalankan proses anak (*child process*) secara headless: `node sidecar/tiktok_worker.js`.

  * Node.js worker membuka koneksi socket klien ke server internal Rust di `ws://127.0.0.1:8765/api/worker/tiktok`.

  * Rust Core menyediakan rute handler khusus yang menerima paket raw JSON, menyematkan UUIDv4, dan menyalurkannya langsung ke Tokio Broadcast Hub.

  * Jika proses worker terputus, Rust Core memicu restart otomatis dengan jeda backoff 5 detik tanpa mengganggu overlay OBS yang sedang aktif.

### 3.3 Struktur Berkas Proyek Target (Target File Tree)

```
zover/
├── Cargo.toml                      # Konfigurasi dependensi Rust & profile release
├── config.json                     # Konfigurasi pengguna (diletakkan di luar biner)
├── src/
│   ├── main.rs                     # Entry point Axum, binding 127.0.0.1, & embedded static
│   ├── ws_hub.rs                   # Broadcast manager, loopback watchdog, drop listener
│   ├── sidecar_manager.rs          # Subprocess watcher untuk worker Node.js
│   └── connectors/
│       ├── kick.rs                 # Native Pusher WebSocket Kick
│       └── youtube.rs              # Native YouTube Live Poller
├── web/                            # DI-EMBED KE DALAM BINARY .EXE
│   ├── index.html
│   ├── overlay_alert.html
│   ├── overlay_chalert.html
│   ├── overlay_chat.html
│   ├── overlay_running_text.html
│   ├── overlay_viewcount.html
│   ├── css/
│   │   ├── alerts.css
│   │   ├── chalert.css
│   │   ├── dashboard.css
│   │   ├── running_text.css
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js
│   │   ├── alerts.js
│   │   ├── chalert.js
│   │   ├── overlay.js
│   │   ├── running_text.js
│   │   ├── viewcount.js
│   │   └── tts.js                  # Dilengkapi FIFO Queue & Deduplication
│   ├── logo_platform/
│   └── media/
├── sidecar/
│   ├── tiktok_worker.js            # Ingestion worker murni
│   └── package.json
└── installer/
    └── zover_setup.iss             # Skrip kompilasi Inno Setup

```

### 3.4 Pipeline Kompilasi & Pembuatan Installer Windows

1. **Optimasi Ukuran Biner (`Cargo.toml`):**

   ```
   [profile.release]
   opt-level = "z"
   lto = true
   codegen-units = 1
   panic = "abort"
   strip = true
   
   ```

2. **Kompilasi Biner Utama:**

   ```
   cargo build --release
   
   ```

   Menghasilkan biner portabel di `target/release/zover.exe` ($\sim 10\text{--}15\text{ MB}$, sudah mencakup seluruh UI, style, dan modul frontend).

3. **Kompilasi Installer Inno Setup:**
   Mengompilasi file `installer/zover_setup.iss` menggunakan Inno Setup Compiler CLI (`iscc.exe`).
   Hasil output berupa installer tunggal: `ZoVer_Installer_v3.0.exe`.

   * Memasang file ke direktori pengguna (`%LOCALAPPDATA%\ZoVer`).

   * Membuat shortcut pada Desktop dan Menu Start.

   * Mengatur opsi autorun saat Windows dinyalakan secara otomatis.