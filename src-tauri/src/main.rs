// 纸间笔记桌面壳：只负责开窗口、把「文件落盘 / 导出 / 剪藏」这几件事暴露给前端。
// 笔记的数据模型、搜索、编辑器全部在前端，Rust 侧不重复实现业务逻辑。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

/// v1.0 曾用 com.inknote.desktop 作为 identifier，改名「纸间笔记」后 app_data_dir()
/// 会指向新目录。若直接启动，老用户会看到空笔记，以为数据丢了。
/// 这里做一次性复制（不移动、不删除旧目录，随时可回退）。
fn migrate_legacy_data(new_dir: &Path) {
    if new_dir.join("workspace.json").exists() {
        return;
    }
    let Some(parent) = new_dir.parent() else { return; };
    let old_dir: PathBuf = parent.join("com.inknote.desktop");
    let old_ws = old_dir.join("workspace.json");
    if !old_ws.exists() {
        return;
    }
    if let Err(e) = std::fs::copy(&old_ws, new_dir.join("workspace.json")) {
        eprintln!("[zhijian] 旧存档迁移失败：{e}");
        return;
    }
    let old_notes = old_dir.join("notes");
    if old_notes.is_dir() {
        if let Err(e) = copy_dir(&old_notes, &new_dir.join("notes")) {
            eprintln!("[zhijian] 旧笔记镜像迁移失败：{e}");
        }
    }
    eprintln!("[zhijian] 已迁移旧数据目录：{}", old_dir.display());
}

pub fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

fn main() {
    // 单实例必须最先注册：已有实例在跑时，第二次启动进程会立即退出，
    // 并在这里把已有窗口拉到前台。
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .setup(|app| {
            // app_data_dir() 在 Windows 上是 %APPDATA%\com.zhijian.desktop
            let default_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("zhijian-data"));
            let _ = std::fs::create_dir_all(&default_dir);
            migrate_legacy_data(&default_dir);

            // 自定义数据目录写在固定位置，配置不会跟着数据目录一起搬走。
            let conf = default_dir.join("zhijian.conf");
            let _ = commands::CONFIG_PATH.set(conf.clone());
            let chosen = std::fs::read_to_string(&conf)
                .ok()
                .map(|s| PathBuf::from(s.trim()))
                .filter(|p| !p.as_os_str().is_empty() && p.is_dir())
                .unwrap_or_else(|| default_dir.clone());
            let _ = std::fs::create_dir_all(&chosen);
            *commands::DATA_DIR.write().expect("数据目录锁异常") = Some(chosen);

            // 关闭行为：默认「最小化到托盘」，可在设置里改为直接退出。
            let mode = commands::load_close_mode();
            *commands::CLOSE_MODE.write().expect("关闭行为锁异常") = mode;

            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 「最小化到托盘」：拦截关闭，藏起来继续跑；退出走托盘菜单。
                let hide = commands::CLOSE_MODE
                    .read()
                    .map(|m| m.as_str() == "hide")
                    .unwrap_or(false);
                if hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_close_behavior,
            commands::data_dir,
            commands::default_data_dir,
            commands::pick_data_dir,
            commands::set_data_dir,
            commands::reset_data_dir,
            commands::load_workspace,
            commands::save_workspace,
            commands::save_export,
            commands::save_export_binary,
            commands::fetch_clip,
            commands::open_url,
            commands::window_action,
            commands::open_data_dir,
            commands::open_attachment_temp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running zhijian");
}

/// 把主窗口从托盘/后台拉回前台。
fn show_main(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 系统托盘：左键单击唤起主窗口，右键菜单「显示主窗口 / 退出」。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("纸间笔记")
        .on_menu_event(|app, ev| match ev.id.as_ref() {
            "show" => show_main(app),
            // 直接退出时绕过 CloseRequested 的「最小化到托盘」拦截。
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
