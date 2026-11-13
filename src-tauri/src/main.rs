// 纸间笔记桌面壳：只负责开窗口、把「文件落盘 / 导出 / 剪藏」这几件事暴露给前端。
// 笔记的数据模型、搜索、编辑器全部在前端，Rust 侧不重复实现业务逻辑。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::path::{Path, PathBuf};
use tauri::Manager;

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
    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
