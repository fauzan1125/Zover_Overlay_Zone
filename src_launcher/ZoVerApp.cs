using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ZoVerDesktop
{
    static class Program
    {
        private static Mutex appMutex;
        private static Process serverProcess;
        private static NotifyIcon trayIcon;
        private static string appDirectory;
        private static bool isExiting = false;
        private static IntPtr trackedWindowHwnd = IntPtr.Zero;

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder strText, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        private const int SW_RESTORE = 9;
        private const uint WM_CLOSE = 0x0010;

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool createdNew;
            appMutex = new Mutex(true, "ZoVer_SingleInstance_Mutex_953D", out createdNew);
            if (!createdNew)
            {
                // Jika ZoVer sudah berjalan, fokuskan jendela dashboard yang aktif tanpa memunculkan dialog popup
                IntPtr existingHwnd = FindZoVerWindow();
                if (existingHwnd != IntPtr.Zero && IsWindow(existingHwnd))
                {
                    ShowWindow(existingHwnd, SW_RESTORE);
                    SetForegroundWindow(existingHwnd);
                }
                else
                {
                    OpenDashboardApp();
                }
                return;
            }

            appDirectory = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(appDirectory);

            AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                try { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "zover_crash.log"), e.ExceptionObject.ToString()); } catch {}
            };
            AppDomain.CurrentDomain.ProcessExit += (s, e) => ExitApplication();
            Application.ApplicationExit += (s, e) => ExitApplication();

            StartServerIfNeeded();
            InitTrayIcon();
            OpenDashboardApp();
            StartWindowWatchdog();

            Application.Run(new ApplicationContext());
        }

        private static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(800);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindNodeExecutable()
        {
            string[] directPaths = new string[]
            {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Programs\node\node.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData) + @"\npm\node.exe"
            };
            foreach (var p in directPaths)
            {
                if (File.Exists(p)) return p;
            }
            return FindExecutableOnPath("node.exe");
        }

        private static void StartServerIfNeeded()
        {
            if (IsPortOpen("127.0.0.1", 8765))
            {
                return; // Server sudah aktif
            }

            string binRustExe = Path.Combine(appDirectory, "bin", "zover_engine.exe");
            string localRustExe = Path.Combine(appDirectory, "zover_engine.exe");
            string nestedRustExe = Path.Combine(appDirectory, "zover-core", "target", "release", "zover.exe");
            string targetRustExe = File.Exists(binRustExe) ? binRustExe : (File.Exists(localRustExe) ? localRustExe : (File.Exists(nestedRustExe) ? nestedRustExe : null));

            if (!string.IsNullOrEmpty(targetRustExe))
            {
                var psi = new ProcessStartInfo
                {
                    FileName = targetRustExe,
                    Arguments = "--no-browser",
                    WorkingDirectory = appDirectory,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                try
                {
                    serverProcess = Process.Start(psi);
                }
                catch {}
            }
            else
            {
                string nodePath = FindNodeExecutable();
                if (!string.IsNullOrEmpty(nodePath) && File.Exists(Path.Combine(appDirectory, "server.js")))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = nodePath,
                        Arguments = "\"" + Path.Combine(appDirectory, "server.js") + "\"",
                        WorkingDirectory = appDirectory,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    try
                    {
                        serverProcess = Process.Start(psi);
                    }
                    catch {}
                }
                else if (File.Exists(Path.Combine(appDirectory, "server.ps1")))
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = "powershell.exe",
                        Arguments = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File \"" + Path.Combine(appDirectory, "server.ps1") + "\"",
                        WorkingDirectory = appDirectory,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    try
                    {
                        serverProcess = Process.Start(psi);
                    }
                    catch {}
                }
            }

            // Tunggu hingga server siap (maksimal 6 detik)
            for (int i = 0; i < 30; i++)
            {
                if (IsPortOpen("127.0.0.1", 8765)) break;
                Thread.Sleep(200);
            }
        }

        private static string FindBrowserPath()
        {
            string[] candidatePaths = new string[]
            {
                @"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
                @"C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Programs\Brave-Browser\Application\brave.exe",
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) + @"\Programs\Opera GX\opera.exe"
            };

            foreach (var path in candidatePaths)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        private static void OpenDashboardApp()
        {
            // Jika jendela dashboard sudah terbuka dan masih ada, restore dan fokuskan
            if (trackedWindowHwnd != IntPtr.Zero && IsWindow(trackedWindowHwnd))
            {
                try
                {
                    ShowWindow(trackedWindowHwnd, SW_RESTORE);
                    SetForegroundWindow(trackedWindowHwnd);
                    return;
                }
                catch {}
            }

            // Tunggu hingga port 8765 benar-benar listening agar browser tidak menampilkan ERR_CONNECTION_REFUSED
            for (int i = 0; i < 25; i++)
            {
                if (IsPortOpen("127.0.0.1", 8765)) break;
                Thread.Sleep(150);
            }

            string browser = FindBrowserPath();
            string url = "http://127.0.0.1:8765/";

            if (!string.IsNullOrEmpty(browser))
            {
                string profileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZoVer", "Profile");
                string args = string.Format("--app=\"{0}\" --window-size=1260,840 --user-data-dir=\"{1}\"", url, profileDir);

                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = args,
                        UseShellExecute = false
                    };
                    Process.Start(psi);
                    return;
                }
                catch {}
            }

            try
            {
                Process.Start(url);
            }
            catch {}
        }

        private static IntPtr FindZoVerWindow()
        {
            IntPtr result = IntPtr.Zero;
            EnumWindows((hWnd, lParam) =>
            {
                int len = GetWindowTextLength(hWnd);
                if (len > 0)
                {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    string title = sb.ToString();

                    if (title.IndexOf("ZoVer", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        title.IndexOf("8765", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        // Hindari mencocokkan editor kode, IDE, atau PowerShell
                        if (!title.Contains(".cs") && !title.Contains(".js") && 
                            !title.Contains("Visual Studio") && !title.Contains("Code") &&
                            !title.Contains("Windows PowerShell") && !title.Contains("Command Prompt"))
                        {
                            result = hWnd;
                            return false; // Ditemukan
                        }
                    }
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        private static void StartWindowWatchdog()
        {
            new Thread(() =>
            {
                while (!isExiting)
                {
                    if (trackedWindowHwnd == IntPtr.Zero || !IsWindow(trackedWindowHwnd))
                    {
                        trackedWindowHwnd = FindZoVerWindow();
                    }
                    Thread.Sleep(1000);
                }
            }) { IsBackground = true }.Start();
        }

        private static void InitTrayIcon()
        {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "ZoVer - Multi-Chat & Alert Hub";

            string logoPath = Path.Combine(appDirectory, "logo_platform", "logo_app.png");
            if (File.Exists(logoPath))
            {
                try
                {
                    using (var bmp = new Bitmap(logoPath))
                    {
                        IntPtr hIcon = bmp.GetHicon();
                        trayIcon.Icon = Icon.FromHandle(hIcon);
                    }
                }
                catch
                {
                    trayIcon.Icon = SystemIcons.Application;
                }
            }
            else
            {
                trayIcon.Icon = SystemIcons.Application;
            }

            var menu = new ContextMenuStrip();

            var headerItem = new ToolStripMenuItem("🎙️ ZoVer Overlay v3.0");
            headerItem.Enabled = false;
            menu.Items.Add(headerItem);

            menu.Items.Add(new ToolStripSeparator());

            var openDashItem = new ToolStripMenuItem("🌐 Buka Dashboard ZoVer");
            openDashItem.Font = new Font(openDashItem.Font, FontStyle.Bold);
            openDashItem.Click += (s, e) => {
                OpenDashboardApp();
                StartWindowWatchdog();
            };
            menu.Items.Add(openDashItem);

            menu.Items.Add(new ToolStripSeparator());

            var obsHeader = new ToolStripMenuItem("📋 Salin Link OBS Browser Source:");
            obsHeader.Enabled = false;
            menu.Items.Add(obsHeader);

            menu.Items.Add("  💬 Salin Link Chatbox", null, (s, e) => CopyToClipboardWithToast("http://127.0.0.1:8765/overlay_chat.html", "Link Chatbox tersalin ke Clipboard!"));
            menu.Items.Add("  🔔 Salin Link Alert", null, (s, e) => CopyToClipboardWithToast("http://127.0.0.1:8765/overlay_alert.html", "Link Alert tersalin ke Clipboard!"));
            menu.Items.Add("  🏝️ Salin Link Chalert (Island)", null, (s, e) => CopyToClipboardWithToast("http://127.0.0.1:8765/overlay_chalert.html", "Link Chalert tersalin ke Clipboard!"));
            menu.Items.Add("  👥 Salin Link ViewCount", null, (s, e) => CopyToClipboardWithToast("http://127.0.0.1:8765/overlay_viewcount.html", "Link ViewCount tersalin ke Clipboard!"));
            menu.Items.Add("  📜 Salin Link Running Text", null, (s, e) => CopyToClipboardWithToast("http://127.0.0.1:8765/overlay_running_text.html", "Link Running Text tersalin ke Clipboard!"));

            menu.Items.Add(new ToolStripSeparator());

            menu.Items.Add("🔄 Restart Server", null, (s, e) => {
                KillServerProcess();
                Thread.Sleep(500);
                StartServerIfNeeded();
                if (trayIcon != null)
                {
                    trayIcon.ShowBalloonTip(2000, "ZoVer", "Server berhasil di-restart!", ToolTipIcon.Info);
                }
            });

            menu.Items.Add("❌ Tutup ZoVer & Matikan Server", null, (s, e) => ExitApplication());

            trayIcon.ContextMenuStrip = menu;
            trayIcon.DoubleClick += (s, e) => {
                OpenDashboardApp();
                StartWindowWatchdog();
            };
            trayIcon.Visible = true;
        }

        private static void CopyToClipboardWithToast(string text, string toastMessage)
        {
            try
            {
                Clipboard.SetText(text);
                if (trayIcon != null)
                {
                    trayIcon.ShowBalloonTip(2000, "OBS Link Copied", toastMessage, ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Gagal menyalin: " + ex.Message);
            }
        }

        private static string FindExecutableOnPath(string exeName)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] paths = pathEnv.Split(';');
            foreach (var p in paths)
            {
                try
                {
                    string full = Path.Combine(p.Trim(), exeName);
                    if (File.Exists(full)) return full;
                }
                catch {}
            }
            return null;
        }

        private static void KillProcessTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo("taskkill", string.Format("/F /T /PID {0}", pid))
                {
                    CreateNoWindow = true,
                    UseShellExecute = false
                };
                using (var proc = Process.Start(psi))
                {
                    if (proc != null) proc.WaitForExit(1500);
                }
            }
            catch {}
        }

        private static void KillPortOwner(int port)
        {
            try
            {
                var psi = new ProcessStartInfo("cmd.exe", string.Format("/c netstat -ano | findstr \":{0} \"", port))
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true
                };
                using (var proc = Process.Start(psi))
                {
                    if (proc != null)
                    {
                        string output = proc.StandardOutput.ReadToEnd();
                        proc.WaitForExit(1000);
                        var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        foreach (var line in lines)
                        {
                            if (line.Contains("LISTENING"))
                            {
                                var parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                                if (parts.Length > 4)
                                {
                                    int pid;
                                    if (int.TryParse(parts[parts.Length - 1], out pid) && pid > 0)
                                    {
                                        KillProcessTree(pid);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch {}
        }

        private static void KillServerProcess()
        {
            if (serverProcess != null)
            {
                try
                {
                    KillProcessTree(serverProcess.Id);
                    serverProcess.Dispose();
                }
                catch {}
                serverProcess = null;
            }

            // Bersihkan proses port 8765 jika masih tersisa
            KillPortOwner(8765);
        }

        private static void ExitApplication()
        {
            if (isExiting) return;
            isExiting = true;

            try
            {
                if (trackedWindowHwnd != IntPtr.Zero && IsWindow(trackedWindowHwnd))
                {
                    try { PostMessage(trackedWindowHwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); } catch {}
                }

                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    trayIcon = null;
                }

                KillServerProcess();

                if (appMutex != null)
                {
                    appMutex.ReleaseMutex();
                    appMutex.Dispose();
                    appMutex = null;
                }
            }
            catch {}
            finally
            {
                Environment.Exit(0);
            }
        }
    }
}