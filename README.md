# 🎙️ ZoVer (Zone Overlay)

**Gabungan live chat Kick + YouTube + TikTok dalam satu OBS Browser Source, dengan pembaca komentar otomatis "Mbak Google" berbahasa Indonesia.**

Aplikasi web ringan (vanilla JavaScript, tanpa build tool) yang berjalan **100% lokal** di PC Anda melalui server PowerShell kecil. Cocok untuk streamer multi-platform yang ingin semua komentar penonton tampil rapi di siaran dan dibacakan dengan suara.

---

## ✨ Fitur

- **3 Platform sekaligus**: Kick, YouTube, dan TikTok dalam satu overlay.
- **YouTube Multi-Live**: dukung beberapa link live sekaligus (mis. stream *portrait* + *landscape*) — semua komentar terbaca.
- **TTS "Mbak Google"**: pembaca komentar Bahasa Indonesia bersuara perempuan dengan antrean, serta pengaturan volume/kecepatan/pitch.
- **Template pembacaan**: sebut username dan platform, mis. `{user} from {platform} berkata {message}`.
- **Filter pintar**: spam simbol seperti `@@@@` dibuang agar tidak dibaca aneh, tetapi mention `@username` tetap utuh; plus blacklist kata kasar.
- **5 tema overlay OBS** + animasi masuk + auto-hide + ukuran teks dapat diatur.
- **Dashboard premium** (Bootstrap 5) dengan pratinjau overlay real-time dan log/konsol aktivitas.
- **Bar ViewCount 3 Platform**: pill transparan + blur (glassmorphism) di atas overlay yang menampilkan jumlah penonton TikTok / YouTube / Kick, dengan pilihan platform mana saja yang ditampilkan.
- **Overlay Alert & Soundboard Terpisah (`overlay_alert.html`)**:
  - Alert Subscriber YouTube
  - Alert Subscriber & Gifting Kick
  - Alert Follower TikTok
  - Alert Gift TikTok (menampilkan nama hadiah & jumlah combo)
  - Alert Tap-Tap TikTok tiap kelipatan 100 like
  - Kotak Media ("TEMPAT GIFT") di tengah dengan dukungan upload file **MP4 / WebM / GIF** atau link URL.
  - Soundboard Audio Alert yang bisa diatur per event dengan upload **MP3** atau link audio.
  - Pengaturan durasi tayang alert & antrean (FIFO queue) agar tidak saling tumpuk saat spam subs/gifts.
- **Sinkronisasi antar-jendela**: dashboard dan overlay OBS selalu selaras (BroadcastChannel + localStorage + config lokal).

---

## 🧩 Syarat Sistem

| Komponen | Keterangan |
|---|---|
| OS | Windows 10/11 |
| Node.js | LTS (v18+ atau v20+). Otomatis dipasang oleh `START_SERVER.bat` jika belum ada |
| Browser | Chrome / Edge modern (untuk dashboard & TTS) |
| OBS Studio | Opsional, untuk menampilkan overlay |
| TikTok Bridge | **Tidak perlu lagi IndoFinity / TikFinity** (Konektor bawaan Native Direct terintegrasi) |

---

## 📥 Cara Install & Menjalankan (dari GitHub)

1. **Clone atau Download** repository ini (`git clone https://github.com/...` atau klik **Code → Download ZIP** lalu ekstrak).
2. **Double-click `START_SERVER.bat`**.
   - Skrip akan otomatis mendeteksi Node.js dan mengunduh dependensi (`npm install`) saat pertama kali dijalankan.
   - Jendela server akan terbuka di `http://localhost:8765`.
   - **Biarkan jendela ini tetap terbuka** selama live streaming.
3. Buka browser, kunjungi **`http://localhost:8765`**.
4. Isi username platform pada menu **Koneksi Stream**, lalu klik **Hubungkan**.
5. (Opsional) Untuk OBS Studio: klik tombol **"Salin Link OBS"** untuk Chatbox, ViewCount, Alert, atau Chalert, lalu tempel sebagai Browser Source di OBS.

---

## 🔌 Koneksi Platform

### Kick
Isi username/channel handle, klik **Hubungkan**. Terhubung langsung ke Kick Pusher WebSocket.

### YouTube (dukung Multi-Live)
Isi **satu atau beberapa** URL/Video ID live, dipisah **koma / spasi / enter**:

```
https://www.youtube.com/watch?v=ID_PORTRAIT, https://www.youtube.com/watch?v=ID_LANDSCAPE
```

- Tanpa API Key → memakai **Scraper Mode** via server lokal (wajib jalankan `START_SERVER.bat`).
- Dengan API Key (opsional) → memakai **YouTube Data API v3**.

### TikTok Live (Native Direct)
1. Masukkan `@username` TikTok Anda di kolom input.
2. Kolom Token / Session ID bersifat opsional (dapat dikosongkan).
3. Klik **Hubungkan**.
4. Chat, Gift, Like tap-tap per 100, Follower alert, dan Viewcount langsung terbaca secara instan tanpa membutuhkan aplikasi pihak ketiga seperti IndoFinity atau TikFinity.

---

## 🗣️ Pengaturan Suara (TTS)

- **Format Pembacaan Pesan** mendukung variabel:
  - `{user}` → nama pengirim
  - `{message}` → isi komentar
  - `{platform}` → YouTube / Kick / TikTok
  - Contoh: `{user} from {platform} berkata {message}` → *"ardiaz from YouTube berkata halo"*
- **Filter Kata Kasar**: komentar yang mengandung kata dalam daftar tidak dibacakan.
- Spam simbol (mis. `@@@@`) otomatis dibersihkan **hanya untuk suara**; tampilan overlay tetap menampilkan pesan asli.

---

## 🎨 Tampilan Overlay OBS

- Pilih dari 5 tema: Gamer Neon, Cyberpunk Dark, Glassmorphic Glow, Minimal Floating, Bubble Chat.
- Atur ukuran teks, animasi masuk, dan durasi auto-hide (0 = tampil selamanya).
- Overlay dirancang **transparan** agar menyatu dengan scene OBS.

## 👁️ Bar ViewCount (Penonton Live)

- Bar pill **transparan + blur** tampil sebagai **Browser Source terpisah** (`overlay_viewcount.html`), mis. `TikTok Views: 12  YouTube Views: 34  Kick Views: 5` — tidak digabung dengan overlay chat agar tata letak bebas diatur.
- Aktif/nonaktifkan lewat switch **"Aktifkan Bar ViewCount"**, dan centang platform mana saja yang ingin ditampilkan (Kick / YouTube / TikTok).
- Angka diambil **best-effort** tiap ±30 detik via server lokal: YouTube menjumlahkan semua live pada kolom multi-live; Kick & TikTok membaca halaman channel/live masing-masing.
- Membutuhkan `START_SERVER.bat` berjalan dan username/link platform sudah terisi.

---

## 🗂️ Struktur Folder

```
├── START_SERVER.bat        # Launcher otomatis server lokal (Node.js auto-detect)
├── server.js               # Server lokal Node.js + WebSocket TikTok Native + Scraper Proxy
├── package.json            # Dependensi Node.js (tiktok-live-connector & ws)
├── index.html              # Dashboard kontrol & konfigurasi (Bootstrap 5)
├── overlay_chat.html       # Halaman transparan OBS untuk kartu live chat
├── overlay_viewcount.html  # Halaman transparan OBS untuk bar viewcount (terpisah)
├── overlay_alert.html      # Halaman transparan OBS untuk alert & soundboard
├── overlay_chalert.html    # Halaman gabungan Chat + Alert
├── config.example.json     # Template konfigurasi referensi
├── css/
│   ├── styles.css          # Tema overlay & kartu chat
│   └── dashboard.css       # Tema slate dashboard
├── logo_platform/
│   ├── kick.png            # Logo Kick
│   ├── youtube.png         # Logo YouTube
│   └── tiktok.jpg          # Logo TikTok
└── js/
    ├── app.js              # Controller utama & sinkronisasi
    ├── overlay.js          # Renderer overlay chat
    ├── tts.js              # Mesin TTS Mbak Google
    ├── viewcount.js        # Monitor & bar viewcount 3 platform
    └── connectors/
        ├── kick.js         # Konektor Kick (Pusher WebSocket)
        ├── youtube.js      # Konektor YouTube (multi-live scraper & API)
        └── tiktok.js       # Konektor TikTok (Native Direct WebSocket)
```

---

## 🔐 Keamanan & Privasi

- Server **hanya bind ke `localhost` / `127.0.0.1`** — tidak terjangkau dari internet.
- Endpoint server dikunci **same-origin** (menolak request lintas-origin/CSRF), proxy dibatasi ke host YouTube (anti-SSRF), dan ada proteksi path-traversal.

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---|---|
| YouTube tidak terhubung | Pastikan `START_SERVER.bat` masih terbuka (Scraper Mode butuh server lokal). |
| TikTok tidak terhubung | Pastikan akun sedang LIVE di TikTok, username sesuai (tanpa spasi/@), dan server aktif via `START_SERVER.bat`. Kolom token biarkan kosong. |
| Suara tidak keluar | Browser memblokir autoplay hingga ada 1 interaksi — klik sekali pada halaman dashboard/overlay. |
| Overlay kosong di OBS | Pastikan path Browser Source mengarah ke `overlay_chat.html` / `overlay_viewcount.html` dari server lokal, dan server masih berjalan. |

---

## 📄 Lisensi

Didistribusikan di bawah lisensi open source [MIT License](LICENSE). Silakan gunakan dan modifikasi untuk keperluan streaming Anda.
