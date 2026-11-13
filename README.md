# 🎙️ ZoVer (Zone Overlay) v3.0

**Live Chat Aggregator & Stream Alert Hub (Kick + YouTube + TikTok) dengan Pembaca Komentar Otomatis "Mbak Google" Indonesia.**

ZoVer adalah aplikasi live streaming overlay multi-platform yang menyatukan obrolan, dynamic alert, viewer counter, running text, soundboard, dan text-to-speech (TTS) ke dalam satu ekosistem OBS Studio.

Dibangun dengan **Arsitektur Hybrid v3.0**: **Rust Core Engine (Axum + Tokio)** sebagai server utama berkemampuan tinggi, ultra-ringan, dan stabil, dipadukan dengan **Node.js Sidecar Worker** terisolasi khusus untuk ingestion TikTok Live.

---

## ✨ Fitur Unggulan

- **🚀 Native Single Executable (`ZoVer.exe`)**:
  - Berjalan 100% lokal tanpa perlu membuka jendela terminal hitam Command Prompt (`.bat`).
  - Terintegrasi langsung dengan Windows System Tray (dekat jam) untuk kontrol cepat, restart, dan salin link OBS.
  - Konsumsi memori ultra-ringan saat idle ($\le 25\text{ MB}$) dan latensi loopback $< 1\text{ ms}$.
- **💬 Agregator 3 Platform Sekaligus**:
  - **Kick Live**: Terhubung langsung ke Kick Pusher WebSocket.
  - **YouTube Live**: Mendukung **Multi-Live** sekaligus (misal stream portrait + landscape bersamaan).
  - **TikTok Live**: Deteksi chat, follower baru, hadiah gift combo beruntun, tap-tap like milestone kelipatan 100, dan statistik viewer realtime.
- **🗣️ TTS "Mbak Google" Indonesia (Zero Ghost Bug)**:
  - 100% suara perempuan Bahasa Indonesia jernih (Anti-Andika, Anti-Macet).
  - Dilengkapi **BroadcastChannel Tab Killer** & antrean serial (FIFO) berdasar event `onend` sehingga tidak pernah terjadi suara dobel saat OBS di-refresh.
  - Template pembacaan kustom: `{user} from {platform} berkata {message}`.
  - Filter cerdas: Membersihkan spam simbol (seperti `@@@@`) khusus untuk suara tanpa merusak teks asli di layar.
- **🎨 Koleksi Widget OBS Mandiri (Browser Source)**:
  - **`overlay_chat.html`**: Chatbox overlay transparan dengan 5 tema (Gamer Neon, Cyberpunk, Glassmorphic, Minimal, Bubble).
  - **`overlay_alert.html`**: Animasi alert subs/gifts/follow dengan media (MP4/WebM/GIF) dan soundboard audio MP3.
  - **`overlay_chalert.html`**: Widget inovatif ala *Dynamic Island* yang menggabungkan Chat + Alert dalam satu kapsul animasi Apple-spring.
  - **`overlay_viewcount.html`**: Bar pill viewcount gabungan Kick + YouTube + TikTok transparan blur.
  - **`overlay_running_text.html`**: Teks berjalan 3D flip vertikal untuk promosi, subathon, atau info sosmed streamer.
- **🔒 Keamanan Tingkat Tinggi**:
  - Binding ketat ke loopback IPv4 `127.0.0.1:8765` (anti-DNS rebinding).
  - Proteksi penuh terhadap path traversal dan Windows 8.3 Short Filename bypass (`CONFIG~1.JSO`).
  - Autentikasi internal token lokal antara Rust Core dan worker sidecar.

---

## 🧩 Kebutuhan Sistem

| Komponen | Spesifikasi |
|---|---|
| **Sistem Operasi** | Windows 10 / 11 (64-bit) |
| **Biner Utama** | `ZoVer.exe` (Portabel, tanpa perlu compile) |
| **Node.js Runtime** | Node.js LTS (v18+ / v20+) — Diperlukan untuk worker TikTok Live |
| **Browser / OBS** | OBS Studio v28+ (CEF Browser Source) & Chrome / Edge modern |

---

## 📥 Cara Menjalankan

### Cara Cepat (Rekomendasi)
1. **Unduh / Clone** repository ini.
2. Pastikan dependensi Node.js terpasang dengan menjalankan `npm install` (cukup sekali di awal).
3. **Klik ganda `ZoVer.exe`**.
   - Server Rust Core otomatis aktif di latar belakang pada `http://127.0.0.1:8765`.
   - Dashboard kontrol langsung terbuka otomatis di browser Anda.
   - Ikon ZoVer akan muncul di System Tray Windows untuk kontrol cepat.
4. Masukkan username channel Anda di menu **Koneksi Stream**, lalu klik **Hubungkan**.
5. Klik **"Salin Link OBS"** pada widget yang diinginkan dan tempelkan sebagai Browser Source di OBS Studio.

---

## 🗂️ Struktur Proyek

```text
chat_yt_kick_tiktok/
├── ZoVer.exe               # Launcher desktop Windows (System Tray)
├── bin/
│   └── zover_engine.exe    # Biner Rust Core Engine (di-embed aset web/)
├── src_launcher/
│   └── ZoVerApp.cs         # Source C# Windows Forms System Tray Launcher
├── config.example.json     # Template konfigurasi awal
├── config.json             # File konfigurasi pengguna (lokal, diabaikan git)
├── server.js               # Server Node.js alternatif
├── server.ps1              # Server PowerShell alternatif
├── package.json            # Manifest dependensi & skrip test
│
├── zover-core/             # Sumber Engine Utama (Rust Axum + Tokio)
│   ├── Cargo.toml          # Konfigurasi dependensi & profile release LTO
│   └── src/
│       ├── main.rs         # Entry point Axum & rust-embed
│       ├── api.rs          # REST API (/api/config, /api/events, /proxy, /api/upload)
│       ├── ws_hub.rs       # Tokio Broadcast Hub & Token Worker Auth
│       └── sidecar_manager.rs # Dynamic supervisor untuk worker TikTok
│
├── sidecar/
│   └── tiktok_worker.js    # Worker TikTok Live (tiklive open-source, tanpa EulerStream)
│
├── web/                    # Seluruh Frontend (Di-embed ke dalam ZoVer.exe)
│   ├── index.html          # Dashboard kontrol utama
│   ├── overlay_chat.html   # Widget live chatbox
│   ├── overlay_alert.html  # Widget media & soundboard alert
│   ├── overlay_chalert.html # Widget dynamic island chat+alert
│   ├── overlay_viewcount.html # Widget counter penonton
│   ├── overlay_running_text.html # Widget banner running text
│   ├── css/                # Stylesheet tema dan animasi
│   ├── js/                 # Logika widget client & mesin TTS
│   ├── logo_platform/      # Asset logo platform streaming
│   └── media/              # Audio & video alert lokal
│
├── installer/
│   └── zover_setup.iss     # Skrip Windows Installer (Inno Setup)
│
└── tests/                  # Test suite pengujian otomatis
    ├── test_server.ps1     # 52 unit test logika server & keamanan
    ├── test_server_security.js # 8 unit test proteksi Windows 8.3 & traversal
    ├── test_suite.html     # Test runner visual browser
    └── run_tests.bat       # Script runner lokal developer
```

---

## 🧪 Menjalankan Pengujian (Testing)

Untuk memverifikasi keutuhan logika server, proteksi keamanan, dan konektor:

```bash
npm test
```

Perintah di atas akan mengeksekusi:
1. **PowerShell Test Suite**: 52 pengujian mencakup MIME types, SSRF whitelist, path traversal, origin guards, dan schema konfigurasi.
2. **Security Test Suite**: 8 pengujian eksklusif keamanan file Windows 8.3 (`CONFIG~1.JSO`, `/NODE_M~1/`, trailing dot & space).

---

## 🛠️ Tips Penggunaan di OBS Studio

1. **Scene Gameplay**: Gunakan opsi **"Add Existing"** saat memasang widget ke scene lain. Matikan centang *"Shutdown source when not visible"* dan *"Refresh browser when scene becomes active"* agar koneksi chat dan antrean suara tidak terputus.
2. **Audio Monitoring**: Jika ingin mendengar suara TTS langsung di headset Anda saat streaming, pastikan browser dashboard tetap terbuka di background atau aktifkan Audio Monitoring pada Browser Source OBS.

---

## 📄 Lisensi

Didistribusikan di bawah lisensi open source [MIT License](LICENSE). Bebas digunakan dan dimodifikasi untuk kebutuhan live streaming Anda.
