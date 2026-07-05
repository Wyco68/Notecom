use std::net::TcpStream;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct ManagedChildren(Mutex<Vec<u32>>);

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("failed to bind ephemeral port")
        .local_addr()
        .expect("failed to read local addr")
        .port()
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn emit_stage(app: &AppHandle, stage: &str) {
    let _ = app.emit_to("splash", "stage-update", stage);
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

// `npm run dev` is spawned under `cmd /C`, which fans out into npm -> node ->
// turbopack worker processes. Child::kill() only kills the immediate cmd.exe
// process and leaves that whole tree running, so cleanup goes through
// taskkill's /T (tree) instead of std::process::Child::kill() / CommandChild::kill().
#[cfg(windows)]
fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    hide_window(&mut cmd);
    let _ = cmd.output();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
}

fn finish_launch(app: &AppHandle, next_port: u16) {
    emit_stage(app, "Launching application...");
    let app_for_main = app.clone();
    let url = format!("http://127.0.0.1:{next_port}/vault");
    app.run_on_main_thread(move || {
        let parsed = url.parse().expect("invalid app url");
        WebviewWindowBuilder::new(&app_for_main, "main", WebviewUrl::External(parsed))
            .title("Notes")
            .inner_size(1280.0, 800.0)
            .min_inner_size(960.0, 600.0)
            .build()
            .expect("failed to create main window");
        if let Some(splash) = app_for_main.get_webview_window("splash") {
            let _ = splash.close();
        }
    })
    .expect("failed to schedule main-thread work");
}

fn track_pids(app: &AppHandle, pids: &[u32]) {
    if let Some(state) = app.try_state::<ManagedChildren>() {
        state.0.lock().unwrap().extend_from_slice(pids);
    }
}

// Dev: vaultd and `npm run dev` are spawned straight from the checked-out
// repo (CARGO_MANIFEST_DIR is desktop/, baked in at compile time — fine since
// a dev build is always run from its own source tree).
#[cfg(debug_assertions)]
mod dev {
    use super::*;
    use std::path::{Path, PathBuf};

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("desktop/ has a parent directory")
            .to_path_buf()
    }

    // npm is `npm.cmd` on Windows (only resolvable through the shell) but a
    // plain executable on macOS/Linux — so it needs `cmd /C` on Windows and a
    // direct invocation everywhere else. Keeping this the one place that knows
    // the difference is what lets `tauri dev` run on all three platforms.
    #[cfg(windows)]
    fn npm(args: &[&str]) -> Command {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("npm").args(args);
        cmd
    }

    #[cfg(not(windows))]
    fn npm(args: &[&str]) -> Command {
        let mut cmd = Command::new("npm");
        cmd.args(args);
        cmd
    }

    // Build tools/<name> if its binary is missing, then run it against the
    // repo's vault/. Shared by vaultd (filesystem helper) and indexd
    // (search/RAG) — identical dev launch shape.
    fn spawn_go_service(root: &Path, name: &str, addr_env: &str, port: u16) -> u32 {
        let dir = root.join("tools").join(name);
        let exe_name = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        };
        let exe = dir.join(&exe_name);
        if !exe.exists() {
            let mut build = Command::new("go");
            build.args(["build", "-o", &exe_name, "."]).current_dir(&dir);
            hide_window(&mut build);
            build.status().expect("failed to build go service");
        }
        let mut cmd = Command::new(&exe);
        cmd.current_dir(root)
            .env(addr_env, format!("127.0.0.1:{port}"))
            .env("VAULT_ROOT", root.join("vault"));
        hide_window(&mut cmd);
        cmd.spawn().expect("failed to start go service").id()
    }

    fn spawn_next(root: &Path, port: u16, vaultd_url: &str, indexd_url: &str) -> u32 {
        let port_arg = port.to_string();
        let mut cmd = npm(&["run", "dev", "--", "-p", &port_arg]);
        cmd.current_dir(root)
            .env("VAULTD_URL", vaultd_url)
            .env("INDEXD_URL", indexd_url);
        hide_window(&mut cmd);
        cmd.spawn().expect("failed to start next dev server").id()
    }

    pub fn orchestrate(app: AppHandle) {
        let root = repo_root();
        let vaultd_port = free_port();
        let indexd_port = free_port();
        let next_port = free_port();
        let vaultd_url = format!("http://127.0.0.1:{vaultd_port}");
        let indexd_url = format!("http://127.0.0.1:{indexd_port}");

        emit_stage(&app, "Starting backend...");
        let vaultd_pid = spawn_go_service(&root, "vaultd", "VAULTD_ADDR", vaultd_port);
        wait_for_port(vaultd_port, Duration::from_secs(15));
        let indexd_pid = spawn_go_service(&root, "indexd", "INDEXD_ADDR", indexd_port);

        emit_stage(&app, "Loading vault...");
        emit_stage(&app, "Preparing interface...");
        let next_pid = spawn_next(&root, next_port, &vaultd_url, &indexd_url);
        wait_for_port(next_port, Duration::from_secs(60));

        track_pids(&app, &[vaultd_pid, indexd_pid, next_pid]);
        finish_launch(&app, next_port);
    }
}

// Release: vaultd, indexd, and a bundled Node runtime are sidecars resolved
// from the installed app's resources. The vault lives in the per-user OS
// data dir (app_data_dir -> %APPDATA%/<id> on Windows, ~/Library/Application
// Support/<id> on macOS, ~/.local/share/<id> on Linux) so an installed copy
// works on any machine — not the build machine's checkout. (Dev still uses
// the repo's vault/, below, which is where /lect writes lessons.)
#[cfg(not(debug_assertions))]
mod release {
    use super::*;
    use std::path::PathBuf;
    use tauri_plugin_shell::ShellExt;

    fn vault_dir(app: &AppHandle) -> PathBuf {
        let dir = app
            .path()
            .app_data_dir()
            .expect("no app data dir")
            .join("vault");
        std::fs::create_dir_all(&dir).expect("failed to create vault dir");
        dir
    }

    fn spawn_vaultd(app: &AppHandle, port: u16, vault_root: &str) -> u32 {
        let (_rx, child) = app
            .shell()
            .sidecar("vaultd")
            .expect("vaultd sidecar not found")
            .env("VAULTD_ADDR", format!("127.0.0.1:{port}"))
            .env("VAULT_ROOT", vault_root.to_string())
            .spawn()
            .expect("failed to start vaultd sidecar");
        child.pid()
    }

    fn spawn_indexd(app: &AppHandle, port: u16, vault_root: &str) -> u32 {
        let (_rx, child) = app
            .shell()
            .sidecar("indexd")
            .expect("indexd sidecar not found")
            .env("INDEXD_ADDR", format!("127.0.0.1:{port}"))
            .env("VAULT_ROOT", vault_root.to_string())
            .spawn()
            .expect("failed to start indexd sidecar");
        child.pid()
    }

    fn spawn_next(app: &AppHandle, port: u16, vaultd_url: &str, indexd_url: &str) -> u32 {
        let frontend_dir = app
            .path()
            .resource_dir()
            .expect("no resource dir")
            .join("resources")
            .join("frontend");

        let (_rx, child) = app
            .shell()
            .sidecar("node")
            .expect("node sidecar not found")
            .current_dir(frontend_dir)
            .args(["server.js"])
            .env("PORT", port.to_string())
            .env("VAULTD_URL", vaultd_url.to_string())
            .env("INDEXD_URL", indexd_url.to_string())
            .spawn()
            .expect("failed to start next standalone server");
        child.pid()
    }

    pub fn orchestrate(app: AppHandle) {
        let vault_root = vault_dir(&app).to_string_lossy().to_string();
        let vaultd_port = free_port();
        let indexd_port = free_port();
        let next_port = free_port();
        let vaultd_url = format!("http://127.0.0.1:{vaultd_port}");
        let indexd_url = format!("http://127.0.0.1:{indexd_port}");

        emit_stage(&app, "Starting backend...");
        let vaultd_pid = spawn_vaultd(&app, vaultd_port, &vault_root);
        wait_for_port(vaultd_port, Duration::from_secs(15));

        // Search/RAG service. Not waited on — the reader works without it and
        // it can index in the background while the UI loads.
        let indexd_pid = spawn_indexd(&app, indexd_port, &vault_root);

        emit_stage(&app, "Loading vault...");
        emit_stage(&app, "Preparing interface...");
        let next_pid = spawn_next(&app, next_port, &vaultd_url, &indexd_url);
        wait_for_port(next_port, Duration::from_secs(30));

        track_pids(&app, &[vaultd_pid, indexd_pid, next_pid]);
        finish_launch(&app, next_port);
    }
}

#[cfg(debug_assertions)]
use dev::orchestrate;
#[cfg(not(debug_assertions))]
use release::orchestrate;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(ManagedChildren(Mutex::new(Vec::new())))
        .setup(|app| {
            WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("splash.html".into()))
                .title("Notes")
                .inner_size(420.0, 260.0)
                .resizable(false)
                .decorations(false)
                .center()
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || orchestrate(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<ManagedChildren>() {
                    let pids = state.0.lock().unwrap();
                    for pid in pids.iter() {
                        kill_tree(*pid);
                    }
                }
            }
        });
}
