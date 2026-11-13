# ZoVer v3.0 Hybrid Architecture (Rust Core + Node.js TikTok Sidecar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform ZoVer into a clean, single-binary hybrid system (Rust Core for HTTP/WS/config serving and Node.js for TikTok Live ingestion) and eliminate all legacy `.bat` scripts.

**Architecture:**
- **Rust Core (`zover-core`)**: Axum server strictly bound to IPv4 `127.0.0.1:8765`. Serves frontend assets directly from memory via `rust-embed` (`web/`), manages persistent configuration (`/api/config`), routes cross-process events (`/api/events`), provides safe proxying (`/proxy`), and acts as the Tokio Broadcast Hub (`/ws`).
- **Node.js TikTok Sidecar (`sidecar/tiktok_worker.js`)**: Runs headless in background supervised by `SidecarManager`. Ingests TikTok Live events via `tiktok-live-connector` and transmits them over an authenticated internal loopback WebSocket (`/api/worker/tiktok`).
- **Clean Deployment**: Legacy root `.bat` files are removed in favor of direct `.exe` execution and npm/PowerShell test automation.

**Tech Stack:** Rust 1.99+ (Axum, Tokio, rust-embed, serde, reqwest), Node.js, `tiktok-live-connector`, PowerShell test runner.

**Spec:** [spesifikasi_arsitektur_zover_v3_0.md](file:///C:/Users/muhamad%20%20fauzan/Documents/chat_yt_kick_tiktok/spesifikasi_arsitektur_zover_v3_0.md) & [rangkuman_perbaikan_bug_blueprint_zover_v3_0.md](file:///C:/Users/muhamad%20%20fauzan/Documents/chat_yt_kick_tiktok/rangkuman_perbaikan_bug_blueprint_zover_v3_0.md)

---

## Global Constraints

- Loopback IPv4 binding must strictly be `127.0.0.1:8765` (no dual-stack wildcard binding).
- TikTok Live scraping logic must remain in Node.js runtime (`sidecar/tiktok_worker.js`).
- Static web assets must be served from `rust-embed` folder `web/`.
- No `.bat` files in repository root.

---

## Tasks

### Task 1: Clean Up Legacy `.bat` Scripts & Update Test Commands

**Files:**
- Delete: `START_SERVER.bat`, `STOP_SERVER.bat`
- Move: `RUN_TESTS.bat` -> `tests/run_tests.bat`
- Modify: `package.json`

- [ ] **Step 1: Update `package.json` test script**
  Add `"test": "powershell -ExecutionPolicy Bypass -File tests/test_server.ps1 && node tests/test_server_security.js"` to `package.json`.
- [ ] **Step 2: Move `RUN_TESTS.bat` to `tests/run_tests.bat` and update path references**
- [ ] **Step 3: Remove `START_SERVER.bat` and `STOP_SERVER.bat`**
- [ ] **Step 4: Verify `npm test` runs successfully**
- [ ] **Step 5: Commit changes**

---

### Task 2: Implement Config & Event REST APIs in Rust Core (`zover-core`)

**Files:**
- Modify: `zover-core/src/main.rs`
- Create: `zover-core/src/api.rs`
- Modify: `zover-core/Cargo.toml`

**Interfaces:**
- Produces:
  - `GET /api/config`: Reads `config.json` (or `config.example.json` fallback).
  - `POST /api/config`: Validates JSON object and writes to `config.json`.
  - `GET /api/events`: Returns matching events since query timestamp.
  - `POST /api/events`: Pushes event to queue and broadcasts to `tx`.
  - `GET /proxy`: Proxies request to whitelisted hosts (YouTube, Kick, TikTok).

- [ ] **Step 1: Write Axum route handlers in `zover-core/src/api.rs`**
  Implement `get_config`, `post_config`, `get_events`, `post_events`, and `proxy_handler` with whitelist checks.
- [ ] **Step 2: Mount routes in `zover-core/src/main.rs`**
- [ ] **Step 3: Compile and run `cargo check` in `zover-core`**
- [ ] **Step 4: Verify test requests against Rust Core endpoints**
- [ ] **Step 5: Commit changes**

---

### Task 3: Dynamic Sidecar Path Discovery & Secure Worker Auth

**Files:**
- Modify: `zover-core/src/sidecar_manager.rs`
- Modify: `zover-core/src/ws_hub.rs`
- Modify: `sidecar/tiktok_worker.js`

**Interfaces:**
- Produces:
  - Dynamic discovery of `tiktok_worker.js` (checks `./sidecar`, `../sidecar`, and relative to `current_exe()`).
  - Shared local secret validation on `/api/worker/tiktok` (e.g., query param or header `x-worker-auth`).

- [ ] **Step 1: Update `SidecarManager` to resolve sidecar script path dynamically**
- [ ] **Step 2: Add shared secret authentication to `tiktok_worker_ws_handler` in `ws_hub.rs`**
- [ ] **Step 3: Update `sidecar/tiktok_worker.js` to send the shared authentication token upon connecting**
- [ ] **Step 4: Verify compilation and connection handshake**
- [ ] **Step 5: Commit changes**

---

### Task 4: Implement 5 Critical Bugfixes from Blueprint (TTS, Like, Reconnect, Viewcount)

**Files:**
- Modify: `js/tts.js` & `web/js/tts.js`
- Modify: `js/alerts.js` & `web/js/alerts.js`
- Modify: `js/connectors/tiktok.js` & `web/js/connectors/tiktok.js`
- Modify: `js/viewcount.js` & `web/js/viewcount.js`
- Modify: `js/overlay.js` & `web/js/overlay.js`

- [ ] **Step 1: TTS Double-Audio Fix (Blueprint §1.1)**
  - Implement `zover_tts_channel` BroadcastChannel tab killer to cancel speech in inactive/old tabs.
  - Implement strict FIFO audio queue with `SpeechSynthesisUtterance.onend/onerror` chaining and ID deduplication (Set of 100 recent IDs).
  - Add `window.addEventListener('beforeunload')` calling `window.speechSynthesis.cancel()`.
- [ ] **Step 2: TikTok Like Alert Mapping (Blueprint §1.2)**
  - Ensure TikTok like packets emit normalized fields: `id`, `user`, `likeCount`, `totalLikeCount`, `avatar`.
  - Fix unescaped `displayCount` in `js/alerts.js` & `web/js/alerts.js`.
- [ ] **Step 3: TikTok Reconnect Memory Leak & Listener Accumulation Fix (Blueprint §1.3)**
  - Clear `reconnectTimer` before re-initiating.
  - Call `removeAllListeners()` and `disconnect()` on the previous connector instance before creating a new connection.
- [ ] **Step 4: TikTok Viewcount Multi-Property & Polling Fallback (Blueprint §1.4)**
  - Read `data.viewerCount ?? data.totalUser ?? data.userCount`.
  - Add 15s fallback polling via `getRoomInfo()`.
- [ ] **Step 5: Favicon Error Loop Fix**
  - Reset `onerror` (`this.onerror=null`) on avatar images in `js/overlay.js` & `web/js/overlay.js`.
- [ ] **Step 6: Verify all client and audio tests pass**

---

### Task 5: Build & Release Verification (Rust Core + Inno Setup)

**Files:**
- Modify: `zover-core/Cargo.toml` (release profile optimization)
- Check: `installer/zover_setup.iss`

- [ ] **Step 1: Configure release optimization in `zover-core/Cargo.toml` (`opt-level = "z"`, `strip = true`)**
- [ ] **Step 2: Run `cargo build --release` in `zover-core`**
- [ ] **Step 3: Verify output binary `zover-core.exe` runs and serves all assets on `127.0.0.1:8765`**
- [ ] **Step 4: Verify `installer/zover_setup.iss` has `onlyifdoesntexist` for config.json and `CloseApplications=yes`**
- [ ] **Step 5: Run comprehensive test suites**
- [ ] **Step 6: Final commit**
