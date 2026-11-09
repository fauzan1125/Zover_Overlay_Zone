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
mod connectors;

use ws_hub::{ws_handler, tiktok_worker_ws_handler, AppState};
use sidecar_manager::SidecarManager;

#[derive(RustEmbed)]
#[folder = "../web/"]
struct StaticAssets;

#[tokio::main]
async fn main() {
    println!("=======================================================");
    println!("  ZoVer Engine v3.0 (Rust Core + Tokio Loopback Hub)   ");
    println!("=======================================================");

    // Inisialisasi Tokio Broadcast Hub
    let (tx, _rx) = broadcast::channel::<String>(256);
    let app_state = Arc::new(AppState { tx });

    // Luncurkan Ingestion Sidecar untuk TikTok jika worker tersedia
    let sidecar = SidecarManager::new("../sidecar/tiktok_worker.js");
    sidecar.run_watchdog().await;

    // Routing
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/worker/tiktok", get(tiktok_worker_ws_handler))
        .fallback(static_asset_handler)
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    // Kunci ketat binding pada IPv4 127.0.0.1:8765
    let addr: SocketAddr = "127.0.0.1:8765"
        .parse()
        .expect("Format alamat loopback tidak valid");
    println!("ZoVer Core aktif dan mendengarkan di http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Gagal melakukan binding TCP loopback pada port 8765");

    axum::serve(listener, app)
        .await
        .expect("ZoVer server mengalami kegagalan proses");
}

async fn static_asset_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_string();

    if path.is_empty() {
        path = "index.html".to_string();
    }

    match StaticAssets::get(&path) {
        Some(content) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .header(header::CACHE_CONTROL, "no-cache")
                .body(Body::from(content.data))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from(format!("404 Not Found: {}", path)))
            .unwrap(),
    }
}
