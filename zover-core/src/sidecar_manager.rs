use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::sleep;

pub struct SidecarManager {
    worker_script: String,
}

impl SidecarManager {
    pub fn new(worker_script: impl Into<String>) -> Self {
        Self {
            worker_script: worker_script.into(),
        }
    }

    /// Menjalankan worker sidecar Node.js dengan watchdog auto-restart
    pub async fn run_watchdog(&self) {
        let script = self.worker_script.clone();
        tokio::spawn(async move {
            loop {
                println!("[Sidecar Watchdog] Meluncurkan Node.js TikTok Worker: {}", script);

                let mut child = match Command::new("node")
                    .arg(&script)
                    .stdout(Stdio::inherit())
                    .stderr(Stdio::inherit())
                    .spawn()
                {
                    Ok(child) => child,
                    Err(err) => {
                        eprintln!("[Sidecar Watchdog Error] Gagal mengeksekusi node: {}. Pastikan Node.js terinstal.", err);
                        sleep(Duration::from_secs(10)).await;
                        continue;
                    }
                };

                // Tunggu jika proses anak mati
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
