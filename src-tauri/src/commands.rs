//! Rust 侧只做四件事：存档读写、纯文本镜像、导出文件、公开网页剪藏。
//! 所有笔记内容以 JSON 存档为单一事实源，同时镜像成 notes/*.md / *.html，
//! 让「数据自己掌握」不是口号：磁盘上随时有一堆能用记事本打开的普通文件。

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

/// 当前数据目录，运行时可切换。自定义目录写在固定位置的 zhijian.conf 里，
/// 所以配置永远找得到，不会跟着数据目录一起搬走。
pub static DATA_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);
pub static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn dir() -> Result<PathBuf, String> {
    DATA_DIR
        .read()
        .map_err(|e| format!("数据目录锁异常：{e}"))?
        .clone()
        .ok_or_else(|| "数据目录尚未初始化".to_string())
}

fn conf_path() -> Option<&'static PathBuf> {
    CONFIG_PATH.get()
}

#[tauri::command]
pub fn data_dir() -> Result<String, String> {
    Ok(dir()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn default_data_dir() -> Result<String, String> {
    Ok(conf_path()
        .and_then(|p| p.parent())
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn pick_data_dir() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<Option<String>, String> {
        Ok(rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("选择目录失败：{e}"))?
}

/// 切换数据目录：校验可写 → 把现有存档与镜像复制过去（旧目录保留）→ 写配置 → 热切换。
#[tauri::command]
pub fn set_data_dir(path: String) -> Result<String, String> {
    let new_dir = PathBuf::from(path.trim());
    if new_dir.as_os_str().is_empty() {
        return Err("路径不能为空".into());
    }
    fs::create_dir_all(&new_dir).map_err(|e| format!("无法创建目录：{e}"))?;
    let probe = new_dir.join(".zhijian-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("目录不可写：{e}"))?;
    let _ = fs::remove_file(&probe);

    let old = dir()?;
    if old != new_dir {
        let old_ws = old.join("workspace.json");
        let new_ws = new_dir.join("workspace.json");
        if old_ws.exists() && !new_ws.exists() {
            fs::copy(&old_ws, &new_ws).map_err(|e| format!("复制存档失败：{e}"))?;
            let old_notes = old.join("notes");
            if old_notes.is_dir() {
                crate::copy_dir(&old_notes, &new_dir.join("notes"))
                    .map_err(|e| format!("复制笔记镜像失败：{e}"))?;
            }
        }
    }
    if let Some(cfg) = conf_path() {
        fs::write(cfg, new_dir.to_string_lossy().as_bytes())
            .map_err(|e| format!("写入配置失败：{e}"))?;
    }
    *DATA_DIR
        .write()
        .map_err(|e| format!("数据目录锁异常：{e}"))? = Some(new_dir.clone());
    Ok(new_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reset_data_dir() -> Result<String, String> {
    let cfg = conf_path().ok_or_else(|| "配置路径尚未初始化".to_string())?;
    let _ = fs::remove_file(cfg);
    let default = cfg.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
    *DATA_DIR
        .write()
        .map_err(|e| format!("数据目录锁异常：{e}"))? = Some(default.clone());
    Ok(default.to_string_lossy().to_string())
}

#[tauri::command]
pub fn load_workspace() -> Result<Option<String>, String> {
    let path = dir()?.join("workspace.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取存档失败：{e}"))?;
    Ok(Some(text))
}

#[tauri::command]
pub fn save_workspace(json: String) -> Result<(), String> {
    let root = dir()?;
    fs::create_dir_all(&root).map_err(|e| format!("创建数据目录失败：{e}"))?;

    // 前端随存档带一份 Markdown 镜像（富文本笔记由 turndown 转好）。
    // 这个临时字段只用于写 notes/*.md，绝不能落进 workspace.json。
    let (clean_json, mirrors) = match serde_json::from_str::<Value>(&json) {
        Ok(mut v) => {
            let m = v.get("__markdownMirrors").cloned();
            if let Value::Object(ref mut map) = v {
                map.remove("__markdownMirrors");
            }
            (serde_json::to_string(&v).unwrap_or_else(|_| json.clone()), m)
        }
        Err(_) => (json.clone(), None),
    };

    // 原子写：先写 .tmp 再 rename，避免断电/崩溃时留下一半的 workspace.json。
    let tmp = root.join("workspace.json.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
        f.write_all(clean_json.as_bytes())
            .map_err(|e| format!("写入存档失败：{e}"))?;
        f.sync_all().map_err(|e| format!("刷盘失败：{e}"))?;
    }
    fs::rename(&tmp, root.join("workspace.json"))
        .map_err(|e| format!("提交存档失败：{e}"))?;

    // 镜像失败不能反过来弄丢主存档，只把错误写日志。
    if let Err(e) = mirror_notes(&root, &clean_json, mirrors.as_ref()) {
        eprintln!("[zhijian] 镜像笔记失败：{e}");
    }
    Ok(())
}

fn safe_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' | '\t' => '-',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '-' || c == ' ');
    let short: String = trimmed.chars().take(48).collect();
    if short.is_empty() {
        "未命名笔记".to_string()
    } else {
        short
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 每篇非回收站笔记镜像成一个普通文本文件；标题改名或删除后清理旧文件。
fn mirror_notes(root: &Path, json: &str, mirrors: Option<&Value>) -> Result<(), String> {
    let value: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let notes = value
        .get("notes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let notes_dir = root.join("notes");
    fs::create_dir_all(&notes_dir).map_err(|e| e.to_string())?;

    let mut keep: HashSet<String> = HashSet::new();
    for note in &notes {
        let id = note.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        // 回收站里的笔记不镜像，恢复后会自动重新出现。
        if note.get("trashed").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        let title = note.get("title").and_then(|v| v.as_str()).unwrap_or("未命名笔记");
        let mode = note.get("mode").and_then(|v| v.as_str()).unwrap_or("markdown");
        let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
        // 正文里的附件短引用要还原成 data URL，否则 notes/*.md 单独打开时看不到图。
        let mut resolved = content.to_string();
        if let Some(arr) = note.get("attachments").and_then(|v| v.as_array()) {
            for a in arr {
                if let (Some(aid), Some(url)) = (
                    a.get("id").and_then(|v| v.as_str()),
                    a.get("dataUrl").and_then(|v| v.as_str()),
                ) {
                    resolved = resolved.replace(&format!("zhijian-attachment:{aid}"), url);
                }
            }
        }
        let tags = note
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|t| t.as_str()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let source = note.get("sourceUrl").and_then(|v| v.as_str()).unwrap_or("");
        let tail: String = id.chars().rev().take(6).collect();

        let mut head = format!("# {title}\n\n");
        if !tags.is_empty() {
            head.push_str(&format!("> 标签：{tags}\n"));
        }
        if !source.is_empty() {
            head.push_str(&format!("> 来源：{source}\n"));
        }
        head.push('\n');

        // 路线 A：默认富文本后仍给每篇笔记一份可读的 .md 镜像。
        // HTML→Markdown 在前端用 turndown 做好随存档传来，Rust 不重复实现转换器。
        let mut files: Vec<(&str, String)> = Vec::new();
        if mode == "rich" {
            let meta = format!("标签：{tags}　来源：{source}");
            files.push((
                "html",
                format!(
                    "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\" />\n<title>{}</title></head><body>\n<h1>{}</h1>\n<p><small>{}</small></p>\n<hr />\n{}\n</body></html>\n",
                    escape_html(title), escape_html(title), escape_html(&meta), resolved
                ),
            ));
            if let Some(md) = mirrors.and_then(|m| m.get(id)).and_then(|v| v.as_str()) {
                files.push(("md", format!("{head}{md}\n")));
            }
        } else {
            files.push(("md", format!("{head}{resolved}\n")));
        }

        for (ext, body) in files {
            let filename = format!("{}-{}.{}", safe_name(title), tail, ext);
            keep.insert(filename.clone());
            let path = notes_dir.join(&filename);
            // 只在内容真的变了才写，标题栏每敲一个字不会反复碰磁盘。
            if fs::read_to_string(&path).ok().as_deref() != Some(body.as_str()) {
                fs::write(&path, body).map_err(|e| format!("写 {filename} 失败：{e}"))?;
            }
        }
    }

    for entry in fs::read_dir(&notes_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if (name.ends_with(".md") || name.ends_with(".html")) && !keep.contains(&name) {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_export(name: String, content: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let path = rfd::FileDialog::new()
            .set_file_name(&name)
            .save_file()
            .ok_or_else(|| "已取消保存".to_string())?;
        fs::write(&path, content).map_err(|e| format!("写入文件失败：{e}"))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("导出任务失败：{e}"))?
}

#[tauri::command]
pub async fn save_export_binary(name: String, base64: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let bytes = STANDARD
            .decode(base64.as_bytes())
            .map_err(|e| format!("解码失败：{e}"))?;
        let path = rfd::FileDialog::new()
            .set_file_name(&name)
            .save_file()
            .ok_or_else(|| "已取消保存".to_string())?;
        fs::write(&path, bytes).map_err(|e| format!("写入文件失败：{e}"))?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("导出任务失败：{e}"))?
}

/// 只用于「剪藏公开网页」。默认挡掉本机 / 内网 / 云元数据地址，
/// 避免这个入口被当成本机端口扫描器用。
fn guard_url(url: &str) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("只支持 http:// 或 https:// 开头的公开网址".into());
    }
    let rest = url.splitn(2, "://").nth(1).unwrap_or("");
    let authority = rest.split('/').next().unwrap_or("");
    let host = authority
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_matches(|c| c == '[' || c == ']')
        .to_lowercase();
    if host.is_empty() {
        return Err("网址缺少主机名".into());
    }
    const BLOCKED: [&str; 6] = [
        "localhost", "127.0.0.1", "0.0.0.0", "::1",
        "169.254.169.254", "metadata.google.internal",
    ];
    if BLOCKED.contains(&host.as_str()) || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("出于安全考虑，不允许剪藏本机或局域网地址".into());
    }
    let parts: Vec<u8> = host
        .split('.')
        .filter_map(|p| p.parse::<u8>().ok())
        .collect();
    if parts.len() == 4 {
        let private = parts[0] == 10
            || parts[0] == 127
            || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16..=31).contains(&parts[1]))
            || (parts[0] == 169 && parts[1] == 254)
            || (parts[0] == 100 && (64..=127).contains(&parts[1]));
        if private {
            return Err("出于安全考虑，不允许剪藏本机或局域网地址".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fetch_clip(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        guard_url(&url)?;
        let body = ureq::get(&url)
            .set("User-Agent", "Mozilla/5.0 (compatible; InknoteClipper/1.0)")
            .set("Accept", "text/html,application/xhtml+xml")
            .timeout(std::time::Duration::from_secs(12))
            .call()
            .map_err(|e| format!("抓取失败：{e}"))?
            .into_string()
            .map_err(|e| format!("读取网页失败：{e}"))?;
        if body.len() > 3_000_000 {
            return Err("页面超过 3 MB，请先复制需要的片段再粘贴".into());
        }
        Ok(body)
    })
    .await
    .map_err(|e| format!("剪藏任务失败：{e}"))?
}

/// 自绘标题栏的窗口按钮走自定义 IPC，前端不需要 @tauri-apps/api/window，
/// 于是整包可以打成单个 IIFE（离线 HTML 也能直接双击打开）。
#[tauri::command]
pub fn window_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    use tauri::Manager;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到主窗口".to_string())?;
    match action.as_str() {
        "min" => win.minimize().map_err(|e| e.to_string()),
        "max" => {
            if win.is_maximized().unwrap_or(false) {
                win.unmaximize().map_err(|e| e.to_string())
            } else {
                win.maximize().map_err(|e| e.to_string())
            }
        }
        "close" => win.close().map_err(|e| e.to_string()),
        _ => Err("未知的窗口动作".into()),
    }
}

/// 笔记正文里的外链交给系统默认浏览器，避免 WebView 把应用页面导航走。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("只允许打开 http/https 链接".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("打开链接失败：{e}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let path = dir()?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开目录失败：{e}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 2.5.9：把附件原样写到临时目录，交给系统默认程序打开。
/// 内嵌预览再怎么还原，也不如 Word / Excel / WPS 自己打开来得 100% 保真，
/// 所以预览弹窗给一个「用本机程序打开」出口；离线 HTML 版没有这层能力，会提示下载。
#[tauri::command]
pub fn open_attachment_temp(name: String, base64_data: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("附件数据损坏：{e}"))?;
    // 文件名只替换 Windows 不允许的字符，中文 / 空格 / 扩展名都保留，
    // 不然 Office 认不出格式，也没法直接另存。
    let safe: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    let dir = std::env::temp_dir().join("zhijian-preview");
    fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    let path = dir.join(&safe);
    fs::write(&path, bytes).map_err(|e| format!("写入临时文件失败：{e}"))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开失败：{e}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开失败：{e}"))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开失败：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 数据目录切换必须：可写校验通过、复制存档与镜像、旧目录保留、配置落盘、可恢复默认。
    #[test]
    fn data_dir_switch_copies_without_losing_old_data() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let base = std::env::temp_dir().join(format!("zhijian-dir-test-{stamp}"));
        let old = base.join("old");
        let new = base.join("new");
        fs::create_dir_all(old.join("notes")).unwrap();
        fs::write(old.join("workspace.json"), r#"{"version":1,"notes":[]}"#).unwrap();
        fs::write(old.join("notes").join("a.md"), "# 一篇笔记\n").unwrap();

        let cfg = base.join("zhijian.conf");
        let _ = CONFIG_PATH.set(cfg.clone());
        *DATA_DIR.write().unwrap() = Some(old.clone());

        let returned = set_data_dir(new.to_string_lossy().to_string()).unwrap();
        assert_eq!(PathBuf::from(returned), new);
        assert!(new.join("workspace.json").exists(), "新目录应有存档");
        assert!(new.join("notes").join("a.md").exists(), "新目录应有笔记镜像");
        assert!(old.join("workspace.json").exists(), "旧目录必须保留可回退");
        assert_eq!(fs::read_to_string(&cfg).unwrap(), new.to_string_lossy());
        assert_eq!(dir().unwrap(), new, "应已热切换到新目录");

        let default = reset_data_dir().unwrap();
        assert_eq!(PathBuf::from(default), base);
        assert!(!cfg.exists(), "恢复默认应删除配置");
        assert_eq!(dir().unwrap(), base);

        // 路线 A：富文本笔记应同时写 .html 与 .md 镜像，
        // 且 __markdownMirrors 只是传输字段，不能落进 workspace.json。
        let mirror_root = base.join("mirrors");
        *DATA_DIR.write().unwrap() = Some(mirror_root.clone());
        // 用三个 # 包 raw string：内容里的 "## 会提前终止 r#"..."#。
        let payload = r###"{"version":1,"notes":[{"id":"n1","title":"富文本笔记","mode":"rich","content":"<h2>标题</h2><p>正文</p>","tags":[],"attachments":[],"trashed":false}],"__markdownMirrors":{"n1":"## 标题\n\n正文"}}"###;
        save_workspace(payload.to_string()).unwrap();
        let saved = fs::read_to_string(mirror_root.join("workspace.json")).unwrap();
        assert!(!saved.contains("__markdownMirrors"), "临时字段不能落盘");
        assert!(mirror_root.join("notes").join("富文本笔记-1n.html").exists());
        let md_path = mirror_root.join("notes").join("富文本笔记-1n.md");
        assert!(md_path.exists(), "富文本笔记也要有 .md 镜像");
        assert!(fs::read_to_string(md_path).unwrap().contains("## 标题"));

        let _ = fs::remove_dir_all(&base);
    }

    /// 空路径必须被拒绝，且不能把当前目录改坏。
    #[test]
    fn rejects_empty_data_dir() {
        let before = dir().ok();
        assert!(set_data_dir("   ".to_string()).is_err());
        assert_eq!(dir().ok(), before);
    }
}
