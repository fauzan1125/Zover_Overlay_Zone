use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use uuid::Uuid;

const KICK_PUSHER_URL: &str = "wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7&client=js&version=7.6.0&flash=false";

pub struct KickConnector {
    tx: broadcast::Sender<String>,
}

impl KickConnector {
    pub fn new(tx: broadcast::Sender<String>) -> Self {
        Self { tx }
    }

    pub async fn listen_channel(&self, chatroom_id: u64) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            loop {
                println!("[Kick Native] Menghubungkan ke Kick Pusher untuk chatroom: {}", chatroom_id);

                match connect_async(KICK_PUSHER_URL).await {
                    Ok((ws_stream, _)) => {
                        let (mut write, mut read) = ws_stream.split();

                        // Subscribe ke channel chatroom
                        let channel_name = format!("chatrooms.{}.v2", chatroom_id);
                        let sub_msg = json!({
                            "event": "pusher:subscribe",
                            "data": {
                                "channel": channel_name
                            }
                        });

                        if write.send(Message::Text(sub_msg.to_string())).await.is_err() {
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                            continue;
                        }

                        while let Some(Ok(msg)) = read.next().await {
                            if let Message::Text(text) = msg {
                                if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                                    let event_name = parsed.get("event").and_then(|v| v.as_str()).unwrap_or("");
                                    if event_name == "App\\Events\\ChatMessageEvent" {
                                        if let Some(raw_data) = parsed.get("data").and_then(|v| v.as_str()) {
                                            if let Ok(chat_obj) = serde_json::from_str::<Value>(raw_data) {
                                                let payload = json!({
                                                    "id": Uuid::new_v4().to_string(),
                                                    "type": "chat",
                                                    "platform": "kick",
                                                    "data": {
                                                        "username": chat_obj.get("sender").and_then(|s| s.get("username")),
                                                        "message": chat_obj.get("content"),
                                                        "createTime": chat_obj.get("created_at")
                                                    }
                                                });
                                                let _ = tx.send(payload.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("[Kick Error] Gagal connect: {}. Reconnecting dalam 5s...", err);
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });
    }
}
