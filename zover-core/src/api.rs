use axum::{
    body::Bytes,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;
use uuid::Uuid;

use crate::ws_hub::AppState;

const ALLOWED_PROXY_HOSTS: &[&str] = &[
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "kick.com",
    "www.kick.com",
    "tiktok.com",
    "www.tiktok.com",
];

const YOUTUBE_COOKIES: &str = "CONSENT=PENDING+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnSmgY";

const ALLOWED_UPLOAD_EXTS: &[&str] = &[
    ".mp3", ".wav", ".ogg", ".m4a", ".aac",
    ".mp4", ".webm", ".mov",
    ".gif", ".png", ".jpg", ".jpeg", ".webp",
];

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

pub fn get_config_path() -> PathBuf {
    if Path::new("config.json").exists() {
        return PathBuf::from("config.json");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p = parent.join("config.json");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from("config.json")
}

pub async fn get_config() -> impl IntoResponse {
    let cfg_path = get_config_path();
    if let Ok(content) = fs::read_to_string(&cfg_path) {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
            .body(content)
            .unwrap();
    }

    // Fallback to config.example.json if present
    let fallback = Path::new("config.example.json");
    if let Ok(content) = fs::read_to_string(fallback) {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
            .body(content)
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body("{}".to_string())
        .unwrap()
}

pub async fn post_config(Json(payload): Json<Value>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    if !payload.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Config must be a JSON object"})),
        ));
    }

    let cfg_path = get_config_path();
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    fs::write(&cfg_path, serialized).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(json!({"status": "ok"})))
}

#[derive(Deserialize)]
pub struct EventQuery {
    pub since: Option<u64>,
}

pub async fn get_events(
    Query(query): Query<EventQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let since = query.since.unwrap_or(0);
    let now = current_time_millis();

    let queue = state.event_queue.lock().unwrap();
    let matching: Vec<Value> = queue
        .iter()
        .filter(|item| {
            let ts = item.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
            ts >= since && (now.saturating_sub(ts)) <= 5000
        })
        .cloned()
        .collect();

    Json(matching)
}

pub async fn post_events(
    State(state): State<Arc<AppState>>,
    Json(mut payload): Json<Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    if !payload.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Payload must be a JSON object"})),
        ));
    }

    let obj = payload.as_object_mut().unwrap();
    if !obj.contains_key("id") {
        obj.insert("id".to_string(), Value::String(Uuid::new_v4().to_string()));
    }
    if !obj.contains_key("timestamp") {
        obj.insert("timestamp".to_string(), Value::from(current_time_millis()));
    }

    let stamped = payload.clone();
    let stamped_str = stamped.to_string();

    {
        let mut queue = state.event_queue.lock().unwrap();
        queue.push(stamped);
        while queue.len() > 100 {
            queue.remove(0);
        }
        let now = current_time_millis();
        queue.retain(|item| {
            let ts = item.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
            now.saturating_sub(ts) <= 5000
        });
    }

    let _ = state.tx.send(stamped_str);
    Ok(Json(json!({"status": "ok"})))
}

#[derive(Deserialize)]
pub struct ProxyQuery {
    pub url: Option<String>,
}

pub async fn proxy_handler(
    Query(query): Query<ProxyQuery>,
    State(state): State<Arc<AppState>>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let target_url = query.url.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Missing url parameter"})),
        )
    })?;

    let parsed = Url::parse(&target_url).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid target url"})),
        )
    })?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid protocol"})),
        ));
    }

    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if !ALLOWED_PROXY_HOSTS.contains(&host.as_str()) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Host not allowed"})),
        ));
    }

    let mut cmd = tokio::process::Command::new("curl.exe");
    cmd.arg("-s")
        .arg("-L")
        .arg("--max-time")
        .arg("12")
        .arg("-A")
        .arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .arg("-H")
        .arg("Accept-Language: en-US,en;q=0.9");

    if host.ends_with("youtube.com") {
        cmd.arg("-H").arg(format!("Cookie: {}", YOUTUBE_COOKIES));
    }

    cmd.arg(parsed.as_str());

    let output = cmd.output().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Failed to execute proxy command: {}", e)})),
        )
    })?;

    if !output.status.success() && output.stdout.is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "Failed to fetch upstream proxy resource"})),
        ));
    }

    let mime = mime_guess::from_path(parsed.path()).first_or_octet_stream();

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(axum::body::Body::from(output.stdout))
        .unwrap())
}

fn sanitize_upload_filename(raw_name: &str) -> String {
    let clean = Path::new(raw_name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>()
        .to_lowercase();

    if clean.trim_matches(|c| c == '_' || c == '.').is_empty() {
        return format!("media_{}.bin", current_time_millis());
    }
    clean
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub filename: Option<String>,
}

#[derive(Deserialize)]
pub struct UploadJsonPayload {
    pub filename: Option<String>,
    pub base64: Option<String>,
}

pub async fn upload_handler(
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body_bytes: Bytes,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let upload_dir = Path::new("media").join("alerts");
    fs::create_dir_all(&upload_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    // Check size limit: max 100 MB
    if body_bytes.len() > 100 * 1024 * 1024 {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error": "Payload too large"})),
        ));
    }

    let raw_name = query
        .filename
        .or_else(|| {
            headers
                .get("x-filename")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        });

    if let Some(name) = raw_name {
        let safe_name = sanitize_upload_filename(&name);
        let ext = Path::new(&safe_name)
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{}", s.to_lowercase()))
            .unwrap_or_default();

        if !ALLOWED_UPLOAD_EXTS.contains(&ext.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Format file tidak diizinkan"})),
            ));
        }

        let target_path = upload_dir.join(&safe_name);
        fs::write(&target_path, &body_bytes).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;

        return Ok(Json(json!({
            "status": "ok",
            "url": format!("media/alerts/{}", safe_name)
        })));
    }

    // Try parse JSON base64
    let json_payload: UploadJsonPayload = serde_json::from_slice(&body_bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid upload format or missing filename"})),
        )
    })?;

    let name = json_payload.filename.unwrap_or_else(|| format!("upload_{}.bin", current_time_millis()));
    let safe_name = sanitize_upload_filename(&name);
    let ext = Path::new(&safe_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| format!(".{}", s.to_lowercase()))
        .unwrap_or_default();

    if !ALLOWED_UPLOAD_EXTS.contains(&ext.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Format file tidak diizinkan"})),
        ));
    }

    let mut b64_str = json_payload.base64.unwrap_or_default();
    if let Some(pos) = b64_str.find(";base64,") {
        b64_str = b64_str[(pos + 8)..].to_string();
    }

    let decoded = base64_decode(&b64_str).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Invalid base64 payload: {}", e)})),
        )
    })?;

    let target_path = upload_dir.join(&safe_name);
    fs::write(&target_path, decoded).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(json!({
        "status": "ok",
        "url": format!("media/alerts/{}", safe_name)
    })))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input.trim())
        .map_err(|e| e.to_string())
}
