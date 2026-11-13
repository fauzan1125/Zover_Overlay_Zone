use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::sleep;

pub struct SidecarManager {
    auth_token: String,
}

impl SidecarManager {
    pub fn new(auth_token: impl Into<String>) -> Self {
        Self {
            auth_token: auth_token.into(),
        }
    }

    pub fn resolve_script_path() -> Option<PathBuf> {
        let candidates = [
            PathBuf::from("sidecar/tiktok_worker.js"),
            PathBuf::from("../sidecar/tiktok_worker.js"),
        ];

        for c in &candidates {
            if c.exists() {
                return Some(c.clone());
            }
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let p1 = parent.join("sidecar").join("tiktok_worker.js");
                if p1.exists() {
                    return Some(p1);
                }
                let p2 = parent.join("..").join("sidecar").join("tiktok_worker.js");
                if p2.exists() {
                    return Some(p2);
                }
            }
        }

        None
    }

    /// Menjalankan worker sidecar Node.js dengan watchdog auto-restart
    pub async fn run_watchdog(&self) {
        let token = self.auth_token.clone();
        tokio::spawn(async move {
            loop {
                let script_path = match Self::resolve_script_path() {
                    Some(p) => p,
                    None => {
                        eprintln!("[Sidecar Watchdog Error] Berkas sidecar/tiktok_worker.js tidak ditemukan.");
                        sleep(Duration::from_secs(10)).await;
                        continue;
                    }
                };

                println!("[Sidecar Watchdog] Meluncurkan Node.js TikTok Worker: {:?}", script_path);

                let mut cmd = Command::new("node");
                cmd.arg(&script_path)
                    .env("ZOVER_WORKER_TOKEN", &token)
                    .env("ZOVER_HUB_WS", format!("ws://127.0.0.1:8765/api/worker/tiktok?token={}", token))
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit());

                let mut child = match cmd.spawn() {
                    Ok(child) => child,
                    Err(err) => {
                        eprintln!("[Sidecar Watchdog Error] Gagal mengeksekusi node: {}. Pastikan Node.js terinstal.", err);
                        sleep(Duration::from_secs(10)).await;
                        continue;
                    }
                };

                let status = child.wait().await;
                eprintln!(
                    "[Sidecar Watchdog] Worker sidecar terhenti dengan status: {:?}. Me-restart dalam 5 detik...",
                    status
                );
                sleep(Duration::from_secs(5)).await;
            }
        });
    }
}
