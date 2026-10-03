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
| PowerShell | Bawaan Windows (dijalankan otomatis oleh `START_SERVER.bat`) |
| Browser | Chrome / Edge modern (untuk dashboard & TTS) |
| OBS Studio | Opsional, untuk menampilkan overlay |
| IndoFinity | **Wajib hanya untuk TikTok** (aplikasi desktop pihak ketiga yang menyediakan WebSocket lokal) |

---

## 📥 Cara Install (dari GitHub ZIP)

1. **Download** repository ini sebagai `.zip` lewat tombol **Code → Download ZIP**, lalu **ekstrak** ke folder mana pun.
2. **Double-click `START_SERVER.bat`**.
   - Jendela hitam akan terbuka = server lokal berjalan di `http://localhost:8765`.
   - **Biarkan jendela ini tetap terbuka** selama live. Menutupnya = mematikan server.
3. Buka browser, kunjungi **`http://localhost:8765`**.
4. Isi kredensial platform pada tab **Koneksi Stream**, lalu klik **Hubungkan**.
5. (Opsional) Untuk OBS: klik tombol **"Salin Path Overlay Chat"** dan **"Salin Path Overlay ViewCount"**, lalu tambahkan **dua Browser Source terpisah** di OBS (satu untuk chat, satu untuk bar viewcount).

> 💡 **Catatan config:** file `config.json` **sengaja tidak disertakan** dalam repo (berisi data pribadi/token). Aplikasi tetap jalan tanpanya dan akan **membuat `config.json` otomatis** saat Anda pertama kali menyimpan pengaturan. Lihat `config.example.json` untuk referensi struktur.

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

### TikTok
Membutuhkan aplikasi **IndoFinity** berjalan di PC yang sama.
1. Buka aplikasi IndoFinity.
2. Isi username TikTok dan **IndoFinity API Token** Anda di dashboard.
3. Klik **Hubungkan**.

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
├── START_SERVER.bat        # Jalan server lokal (double-click)
├── server.ps1              # Server lokal + proxy YouTube + API config
├── index.html              # Dashboard kontrol (Bootstrap 5)
├── overlay_chat.html       # Halaman transparan OBS untuk kartu live chat
├── overlay_viewcount.html  # Halaman transparan OBS untuk bar viewcount (terpisah)
├── config.example.json     # Template konfigurasi (referensi)
├── css/
│   ├── styles.css          # Tema overlay & kartu chat
│   └── dashboard.css       # Tema slate premium dashboard
├── logo_platform/
│   ├── kick.png            # Logo Kick untuk header kartu
│   ├── youtube.png         # Logo YouTube untuk header kartu
│   └── tiktok.jpg          # Logo TikTok untuk header kartu
└── js/
    ├── app.js              # Controller utama & sinkronisasi
    ├── overlay.js          # Renderer overlay
    ├── tts.js              # Mesin TTS Mbak Google
    ├── viewcount.js        # Monitor & bar viewcount 3 platform
    └── connectors/
        ├── kick.js         # Konektor Kick
        ├── youtube.js      # Konektor YouTube (multi-live)
        └── tiktok.js       # Konektor TikTok (IndoFinity)
```

---

## 🔐 Keamanan & Privasi

- Server **hanya bind ke `localhost` / `127.0.0.1`** — tidak terjangkau dari internet.
- **Jangan host proyek ini ke internet publik.** Ini dirancang sebagai tool lokal/desktop.
- Endpoint server dikunci **same-origin** (menolak request lintas-origin/CSRF), proxy dibatasi ke host YouTube (anti-SSRF), dan ada proteksi path-traversal.
- Token API (IndoFinity / YouTube) disimpan **lokal** di `config.json` yang **di-ignore Git**, sehingga tidak ikut ter-upload ke GitHub.

---

## 🛠️ Troubleshooting

| Masalah | Solusi |
|---|---|
| YouTube tidak terhubung | Pastikan `START_SERVER.bat` masih terbuka (Scraper Mode butuh server lokal). |
| TikTok tidak terhubung | Pastikan aplikasi IndoFinity berjalan dan token benar. |
| Suara tidak keluar | Browser memblokir autoplay hingga ada 1 interaksi — klik sekali pada halaman dashboard/overlay. |
| Overlay kosong di OBS | Pastikan path Browser Source mengarah ke `overlay_chat.html` / `overlay_viewcount.html` dari server lokal, dan server masih berjalan. |

---

## 📄 Lisensi

Didistribusikan di bawah lisensi open source [MIT License](LICENSE). Silakan gunakan dan modifikasi untuk keperluan streaming Anda.
