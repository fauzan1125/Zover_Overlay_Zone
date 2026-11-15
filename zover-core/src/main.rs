use axum::{
    body::Body,
    http::{header, Response, StatusCode, Uri},
    response::IntoResponse,
    routing::get,
    Router,
};
use rust_embed::RustEmbed;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

mod ws_hub;
mod sidecar_manager;
mod api;

use ws_hub::{ws_handler, tiktok_worker_ws_handler, tiktok_client_ws_handler, AppState};
use sidecar_manager::SidecarManager;

#[derive(RustEmbed)]
#[folder = "../web/"]
struct StaticAssets;

#[tokio::main]
async fn main() {
    println!("=======================================================");
    println!("  ZoVer Engine v3.0 (Rust Core + Tokio Loopback Hub)   ");
    println!("=======================================================");

    // Inisialisasi Tokio Broadcast Hub & State
    let (tx, _rx) = broadcast::channel::<String>(256);
    let (worker_cmd_tx, _worker_cmd_rx) = broadcast::channel::<String>(32);
    let worker_auth_token = uuid::Uuid::new_v4().to_string();
    let app_state = Arc::new(AppState {
        tx,
        worker_cmd_tx,
        event_queue: Arc::new(std::sync::Mutex::new(Vec::new())),
        audio_claims: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        worker_auth_token: worker_auth_token.clone(),
    });

    // Luncurkan Ingestion Sidecar untuk TikTok jika worker tersedia
    let sidecar = SidecarManager::new(&worker_auth_token);
    sidecar.run_watchdog().await;

    // Routing
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/ws/tiktok", get(tiktok_client_ws_handler))
        .route("/api/tiktok-ws", get(tiktok_client_ws_handler))
        .route("/api/worker/tiktok", get(tiktok_worker_ws_handler))
        .route("/api/config", get(api::get_config).post(api::post_config))
        .route("/api/events", get(api::get_events).post(api::post_events))
        .route("/api/claim", get(api::claim_audio).post(api::claim_audio))
        .route("/proxy", get(api::proxy_handler))
        .route("/api/upload", axum::routing::post(api::upload_handler))
        .fallback(static_asset_handler)
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    // Kunci ketat binding pada IPv4 127.0.0.1:8765
    let addr: SocketAddr = "127.0.0.1:8765"
        .parse()
        .expect("Format alamat loopback tidak valid");
    println!("ZoVer Core aktif dan mendengarkan di http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(err) => {
            eprintln!("[ZoVer] Port 8765 sudah digunakan: {}. Membuka browser dashboard...", err);
            open_browser("http://127.0.0.1:8765/");
            return;
        }
    };

    // Buka browser secara otomatis jika tidak dijalankan dalam mode headless
    let args: Vec<String> = std::env::args().collect();
    let no_browser = args.iter().any(|a| a == "--headless" || a == "--no-browser");
    if !no_browser {
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            open_browser("http://127.0.0.1:8765/");
        });
    }

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[ZoVer] Server terhenti dengan galat: {}", e);
    }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", url])
            .spawn();
    }
}

async fn static_asset_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() {
        path = "index.html".to_string();
    }

    let decoded = path.replace("%20", " ").replace("%2e", ".").replace("%2E", ".").replace("%2f", "/").replace("%2F", "/").replace("%5c", "\\").replace("%5C", "\\");
    let lower = decoded.to_lowercase();
    let has_unsafe_segment = decoded.split('/').any(|seg| seg.ends_with('.') || seg.ends_with(' ') || seg.contains('~'));

    // Amankan dari path traversal, Windows 8.3 SFN, dan akses file sensitif sebelum membaca disk
    if has_unsafe_segment || lower.contains("..") || lower.contains(':') || lower.contains('\\') || lower.starts_with('.') || lower.starts_with("node_modules") || lower.contains("config.json") || lower == "server.ps1" || lower == "server.js" {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("403 Forbidden"))
            .unwrap();
    }

    // Prioritaskan file kerja lokal (js/, css/, media/) agar pembaruan langsung aktif tanpa cache basi
    let file_path = std::path::Path::new(&path);
    if file_path.exists() && file_path.is_file() {
        if let Ok(data) = std::fs::read(file_path) {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let cache_ctrl = if path.starts_with("media/") { "public, max-age=3600" } else { "no-cache" };
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, cache_ctrl)
                .body(Body::from(data))
                .unwrap();
        }
    }

    // Fallback ke embedded static assets
    if let Some(content) = StaticAssets::get(&path) {
        let mime = mime_guess::from_path(&path).first_or_octet_stream();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime.as_ref())
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(content.data))
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(format!("404 Not Found: {}", path)))
        .unwrap()
}
