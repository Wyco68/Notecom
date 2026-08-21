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
            .title("Notecom")
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

// Dev: `npm run dev` is spawned straight from the checked-out repo
// (CARGO_MANIFEST_DIR is desktop/, baked in at compile time — fine since a dev
// build is always run from its own source tree).
//
// There is one child process now. The app used to launch three Go sidecars
// first — vaultd (files), stored (local SQLite + background sync) and indexd
// (search) — because the desktop copy was the source of truth and Supabase was
// a replica it pushed to. That is reversed: Supabase is the store, the app
// talks to it directly, and there is nothing local left to serve.
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

    // VAULT_ROOT still points at the repo's vault/: that is where Claude Code
    // writes generated lessons, and the app imports them from there on the next
    // tree load. Read-only as far as the app is concerned.
    fn spawn_next(root: &Path, port: u16) -> u32 {
        let port_arg = port.to_string();
        let mut cmd = npm(&["run", "dev", "--", "-p", &port_arg]);
        cmd.current_dir(root).env("VAULT_ROOT", root.join("vault"));
        hide_window(&mut cmd);
        cmd.spawn().expect("failed to start next dev server").id()
    }

    pub fn orchestrate(app: AppHandle) {
        let root = repo_root();
        let next_port = free_port();

        emit_stage(&app, "Preparing interface...");
        let next_pid = spawn_next(&root, next_port);
        wait_for_port(next_port, Duration::from_secs(60));

        track_pids(&app, &[next_pid]);
        finish_launch(&app, next_port);
    }
}

// Release: a bundled Node runtime is the only sidecar, resolved from the
// installed app's resources. The vault, and the /lect + /quiz command files
// that write to it, live in a per-user app-data directory instead of the
// checkout that built the app — CARGO_MANIFEST_DIR is baked in at compile
// time, so an installer built on a CI runner would bake in that runner's
// ephemeral checkout path and be unable to find anything once installed
// somewhere else. Resolving the project dir at runtime (`app.path()
// .app_data_dir()`) is what makes a CI-built installer usable by anyone who
// downloads it, not just the machine that built it.
#[cfg(not(debug_assertions))]
mod release {
    use super::*;
    use std::path::{Path, PathBuf};
    use tauri_plugin_shell::ShellExt;

    fn project_root(app: &AppHandle) -> PathBuf {
        app.path()
            .app_data_dir()
            .expect("no app data dir")
            .join("project")
    }

    fn vault_dir(app: &AppHandle) -> PathBuf {
        let dir = project_root(app).join("vault");
        std::fs::create_dir_all(&dir).expect("failed to create vault dir");
        dir
    }

    fn copy_dir_recursive(src: &Path, dst: &Path) {
        if !src.exists() {
            return;
        }
        std::fs::create_dir_all(dst).expect("failed to create project dir");
        for entry in std::fs::read_dir(src).expect("failed to read bundled resources") {
            let entry = entry.expect("resource dir entry");
            let dest_path = dst.join(entry.file_name());
            if entry.file_type().expect("resource file type").is_dir() {
                copy_dir_recursive(&entry.path(), &dest_path);
            } else {
                std::fs::copy(entry.path(), &dest_path).expect("failed to copy resource file");
            }
        }
    }

    // Re-synced on every launch, so an app update always ships the current
    // /lect, /quiz, docs and validators. vault/ is never part of the bundled
    // resource, so a user's actual notes are never touched by this.
    fn sync_project_template(app: &AppHandle) {
        let bundled = app
            .path()
            .resource_dir()
            .expect("no resource dir")
            .join("resources")
            .join("claude-project");
        copy_dir_recursive(&bundled, &project_root(app));
    }

    fn spawn_next(app: &AppHandle, port: u16, vault_root: &str, repo_root: &str) -> u32 {
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
            // Where Claude Code (/lect, /quiz) writes generated lessons. The
            // app imports from here; it never writes back.
            .env("VAULT_ROOT", vault_root.to_string())
            // Generate (lib/generate/runner.ts) must run the claude CLI from
            // a directory holding .claude/commands/ — the standalone
            // server's own cwd is the installed resources dir, not this one.
            .env("REPO_ROOT", repo_root.to_string())
            .spawn()
            .expect("failed to start next standalone server");
        child.pid()
    }

    pub fn orchestrate(app: AppHandle) {
        sync_project_template(&app);
        let vault_root = vault_dir(&app).to_string_lossy().to_string();
        let repo_root = project_root(&app).to_string_lossy().to_string();
        let next_port = free_port();

        emit_stage(&app, "Preparing interface...");
        let next_pid = spawn_next(&app, next_port, &vault_root, &repo_root);
        wait_for_port(next_port, Duration::from_secs(30));

        track_pids(&app, &[next_pid]);
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
                .title("Notecom")
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
