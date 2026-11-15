use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
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
    pub worker_cmd_tx: broadcast::Sender<String>,
    pub event_queue: Arc<Mutex<Vec<Value>>>,
    pub audio_claims: Arc<Mutex<std::collections::HashMap<String, u64>>>,
    pub worker_auth_token: String,
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

#[derive(Deserialize)]
pub struct WorkerWsQuery {
    pub token: Option<String>,
}

/// Endpoint untuk Worker Sidecar TikTok mengirim payload raw ke Rust Core
pub async fn tiktok_worker_ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<WorkerWsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    // Validasi token autentikasi rahasia internal worker
    let token = query.token.unwrap_or_default();
    if token.is_empty() || token != state.worker_auth_token {
        return (StatusCode::UNAUTHORIZED, "Unauthorized TikTok Worker").into_response();
    }

    ws.on_upgrade(|socket| handle_tiktok_worker_socket(socket, state)).into_response()
}

async fn handle_tiktok_worker_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut cmd_rx = state.worker_cmd_tx.subscribe();

    println!("[TikTok Worker Hub] Node.js TikTok worker terhubung.");

    loop {
        tokio::select! {
            // Kirim perintah kontrol (misal: connect username) ke Node.js sidecar worker
            Ok(cmd) = cmd_rx.recv() => {
                if sender.send(Message::Text(cmd)).await.is_err() {
                    break;
                }
            }
            // Terima payload stream dari Node.js worker dan broadcast ke seluruh client
            Some(msg_res) = receiver.next() => {
                match msg_res {
                    Ok(Message::Text(text)) => {
                        if let Ok(mut json_val) = serde_json::from_str::<Value>(&text) {
                            if json_val.get("id").is_none() {
                                if let Some(obj) = json_val.as_object_mut() {
                                    obj.insert("id".to_string(), Value::String(Uuid::new_v4().to_string()));
                                }
                            }
                            let stamped = json_val.to_string();
                            let _ = state.tx.send(stamped);
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => {
                        break;
                    }
                    _ => {}
                }
            }
            else => break,
        }
    }
    println!("[TikTok Worker Hub] Node.js TikTok worker terputus.");
}

#[derive(Deserialize)]
pub struct TikTokWsQuery {
    pub username: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub token: Option<String>,
}

/// Endpoint WebSocket TikTok untuk konsumsi langsung oleh frontend (tiktok.js)
pub async fn tiktok_client_ws_handler(
    ws: WebSocketUpgrade,
    Query(query): Query<TikTokWsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let username = query.username.unwrap_or_default().trim().trim_start_matches('@').to_string();
    let session_id = query.session_id.or(query.token);

    ws.on_upgrade(move |socket| handle_tiktok_client_socket(socket, state, username, session_id))
}

async fn handle_tiktok_client_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    username: String,
    session_id: Option<String>,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    if !username.is_empty() {
        // Kirim instruksi connect ke Sidecar Worker Node.js
        let cmd = serde_json::json!({
            "action": "connect",
            "username": username,
            "sessionId": session_id
        }).to_string();
        let _ = state.worker_cmd_tx.send(cmd);

        // Kirim status connecting awal ke client
        let init_status = serde_json::json!({
            "type": "status",
            "status": "connecting",
            "message": format!("Menghubungkan ke TikTok Live (@{})...", username)
        }).to_string();
        let _ = sender.send(Message::Text(init_status)).await;
    }

    loop {
        tokio::select! {
            Ok(msg_text) = rx.recv() => {
                if sender.send(Message::Text(msg_text)).await.is_err() {
                    break;
                }
            }
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
