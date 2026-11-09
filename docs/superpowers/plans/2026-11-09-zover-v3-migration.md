# ZoVer v3.0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan perbaikan Zero-Ghost Connection, FIFO Audio Queue, UUIDv4 deduplication, dan mempersiapkan scaffolding migrasi Rust Core + Sidecar sesuai spesifikasi ZoVer v3.0.

**Architecture:** Menerapkan pertahanan multi-layer terhadap bug double audio pada frontend & server terlebih dahulu (UUID deduplication cache, serial playback mutex lock, clean socket teardown on `beforeunload`), dilanjutkan dengan penyiapan pondasi Rust Axum + Tokio untuk biner mandiri Windows.

**Tech Stack:** JavaScript (ES6+, Web Speech API, WebSockets), Node.js v24, Rust (Axum, Tokio, rust-embed), Inno Setup Compiler.

**Spec:** [spesifikasi_arsitektur_zover_v3_0.md](file:///C:/Users/muhamad%20%20fauzan/Documents/chat_yt_kick_tiktok/spesifikasi_arsitektur_zover_v3_0.md)

## Global Constraints

- Kompatibilitas browser source OBS: Tidak boleh merusak format payload yang dikonsumsi oleh `overlay_*.html`.
- Port binding: Mengunci ke IPv4 `127.0.0.1:8765` secara konsisten.
- Zero Ghost Audio: Pemutaran TTS dan alert harus strictly FIFO serial tanpa tumpang-tindih.
- Modularitas: Frontend tetap vanilla JS tanpa dependensi bundler eksternal.

## Review Focus

1. **Refresh Burst di OBS:** Melakukan reload browser source OBS berulang kali saat stream chat deras tidak boleh menghasilkan double speech atau error `speechSynthesis` stuck.
2. **Duplicate Event Handling:** Event chat/gift berulang dengan UUID sama dalam 60 detik harus langsung ditolak oleh deduplication cache.
3. **Audio Queue Preemption:** Event alert gift berprioritas tinggi harus dapat ditangani tertib tanpa meng-abort pemutaran audio aktif yang sedang bersuara secara glitchy.
4. **WebSocket Graceful Teardown:** Event `beforeunload` harus mengirim close frame eksplisit dan membatalkan speech queue aktif.
5. **Node.js Sidecar Isolation:** Jika worker TikTok error, overlay dan TTS YouTube/Kick tidak boleh terhenti.

---

### Task 1: Client-Side UUID Deduplication & Lifecycle Teardown

**Files:**
- Modify: `js/tts.js`
- Modify: `overlay_chat.html`
- Modify: `overlay_alert.html`
- Modify: `overlay_chalert.html`
- Test: `tests/tests.js`

- [ ] **Step 1: Tulis unit test untuk verifikasi deduplikasi UUID dan Circular Cache**
  Buat test case di `tests/tests.js` yang menyimulasikan penerimaan payload dengan ID yang sama 2x dan memastikan pemrosesan hanya terjadi 1x.
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
  Verifikasi test deduplikasi gagal sebelum implementasi.
- [ ] **Step 3: Implementasikan Circular Deduplication Cache di `js/tts.js` dan `js/app.js`**
  Gunakan `Set` dengan kapasitas maksimal 200 UUID dan timestamp retensi 60 detik. Helper `isDuplicateEvent(eventId)`.
- [ ] **Step 4: Tambahkan handler `beforeunload` pada seluruh halaman overlay**
  Di `overlay_chat.html`, `overlay_alert.html`, `overlay_chalert.html`, tangkap `window.addEventListener('beforeunload', ...)` untuk memanggil `window.speechSynthesis?.cancel()` dan menutup koneksi WebSocket aktif dengan kode normal closure (1000).
- [ ] **Step 5: Jalankan test dan pastikan lolos (GREEN)**
  Jalankan `npm test` atau runner node untuk memvalidasi test.

---

### Task 2: Deterministic FIFO Audio Queue & PlaybackLockState Mutex

**Files:**
- Modify: `js/tts.js`
- Test: `tests/tests.js`

- [ ] **Step 1: Tulis unit test untuk FIFO Audio Queue & Mutex Lock**
  Buat pengujian di mana 3 pesan TTS masuk hampir bersamaan; verifikasi bahwa urutan eksekusi adalah serial (pesan 2 hanya diproses setelah `onended` pesan 1).
- [ ] **Step 2: Jalankan test dan pastikan gagal (RED)**
- [ ] **Step 3: Implementasi class `DeterministicAudioQueue` dengan `PlaybackLockState` di `js/tts.js`**
  Tambahkan state lock boolean, antrean array berbasis FIFO, timeout watchdog fallback (jika browser `speechSynthesis` macet > 10 detik tanpa memicu `onended`/`onerror`), dan fungsi unlock otomatis.
- [ ] **Step 4: Jalankan test dan pastikan lolos (GREEN)**

---

### Task 3: Backend UUID Stamping & Strict IPv4 Binding

**Files:**
- Modify: `server.js`
- Test: `tests/probe_test.js`

- [ ] **Step 1: Tulis test probe untuk UUID payload stamping & IPv4 binding**
  Pastikan setiap event yang disalurkan server menyertakan field `id` berformat UUIDv4 jika belum ada, dan server hanya bind ke `127.0.0.1`.
- [ ] **Step 2: Implementasi `crypto.randomUUID()` stamping pada pipeline broadcast `server.js`**
  Di `server.js`, pada endpoint scraper YouTube dan listener TikTok native, tambahkan UUIDv4 jika `msgId` tidak tersedia dari platform.
- [ ] **Step 3: Kunci HTTP dan WebSocket server binding pada `127.0.0.1`**
  Pastikan `server.listen(PORT, '127.0.0.1')` digunakan tanpa membiarkan default fallback `0.0.0.0` atau IPv6.
- [ ] **Step 4: Jalankan test probe untuk verifikasi**

---

### Task 4: Persiapan Scaffolding Rust Core (Axum + Tokio)

**Files:**
- Create: `zover-core/Cargo.toml` (atau workspace root jika disetujui)
- Create: `zover-core/src/main.rs`
- Create: `zover-core/src/ws_hub.rs`

- [ ] **Step 1: Konfirmasi instalasi toolchain Rust (via `winget install Rustlang.Rustup`) dengan pengguna**
- [ ] **Step 2: Inisialisasi crate Rust dengan dependensi `axum`, `tokio`, `tower-http`, `rust-embed`**
- [ ] **Step 3: Implementasikan embedded static asset handler dan loopback Tokio broadcast hub**
- [ ] **Step 4: Uji kompilasi biner `cargo build`**
