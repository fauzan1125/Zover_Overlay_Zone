use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub id: Uuid,
    pub platform: String,
    pub event_type: String,
    pub sender_name: String,
    pub content: String,
    pub timestamp: u64,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone)]
pub struct AppState {
    pub tx: broadcast::Sender<String>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_client_socket(socket, state))
}

async fn handle_client_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Loopback Anti-Ghost Watchdog: Segera drop task saat koneksi client putus atau refresh
    loop {
        tokio::select! {
            // Event baru dari Broadcast Hub dikirim ke browser/OBS client
            Ok(msg_text) = rx.recv() => {
                if sender.send(Message::Text(msg_text)).await.is_err() {
                    // Client terputus atau OBS browser source direfresh
                    break;
                }
            }
            // Menerima frame dari client (Close / Ping)
            Some(msg_res) = receiver.next() => {
                match msg_res {
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    Ok(Message::Ping(data)) => {
                        let _ = sender.send(Message::Pong(data)).await;
                    }
                    _ => {}
                }
            }
            else => break,
        }
    }
}

/// Endpoint untuk Worker Sidecar TikTok mengirim payload raw ke Rust Core
pub async fn tiktok_worker_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_tiktok_worker_socket(socket, state))
}

async fn handle_tiktok_worker_socket(socket: WebSocket, state: Arc<AppState>) {
    let (_sender, mut receiver) = socket.split();

    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
            if let Ok(mut json_val) = serde_json::from_str::<Value>(&text) {
                // Pastikan UUID unik distamp pada level Rust Hub
                if json_val.get("id").is_none() {
                    if let Some(obj) = json_val.as_object_mut() {
                        obj.insert("id".to_string(), Value::String(Uuid::new_v4().to_string()));
                    }
                }
                let stamped = json_val.to_string();
                let _ = state.tx.send(stamped);
            }
        }
    }
}
