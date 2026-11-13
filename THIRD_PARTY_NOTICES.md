# 第三方组件声明

本文件随纸间笔记的二进制分发一起提供。主项目代码按 **Apache-2.0** 授权。

## 双许可组件的显式选择

部分依赖提供多个许可证，本项目明确选用如下分支，**不选 GPL 分支**：

| 组件 | 上游声明 | 本项目选用 |
| --- | --- | --- |
| `dompurify` | `MPL-2.0 OR Apache-2.0` | **Apache-2.0** |
| `jszip` | `MIT OR GPL-3.0-or-later` | **MIT** |
| `@tauri-apps/api` / `@tauri-apps/cli` | `Apache-2.0 OR MIT` | Apache-2.0 |
| `tauri` / `tauri-build` / `serde` / `serde_json` / `base64` / `ureq` | `Apache-2.0 OR MIT` | Apache-2.0 |

## 前端直接依赖

数据来自 2026-11-13 对 `node_modules/*/package.json` 的实测。

| 组件 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `@tauri-apps/api` | 2.12.4 | Apache-2.0 OR MIT | 仅保留类型参考，运行时已改为直接调用 IPC |
| `@tauri-apps/cli` | 2.12.4 | Apache-2.0 OR MIT | 构建时 |
| `dompurify` | 3.4.17 | MPL-2.0 OR Apache-2.0 | 剪藏 / 粘贴 HTML 清洗、Markdown 预览清洗 |
| `jszip` | 3.10.2 | MIT OR GPL-3.0-or-later | 全库 Markdown ZIP 导出、Office 附件预览解析 |
| `docx-preview` | 0.4.1 | Apache-2.0 | Word（DOCX）文档高保真预览渲染 |
| `lucide-react` | 0.468.0 | ISC | 图标 |
| `marked` | 15.0.12 | MIT | Markdown → HTML |
| `react` / `react-dom` | 18.3.1 | MIT | UI |
| `turndown` | 7.2.5 | MIT | HTML → Markdown |
| `@tiptap/core` / `@tiptap/react` / `@tiptap/starter-kit` / `@tiptap/pm` | ^3.33.1 | MIT | 富文本编辑内核 |
| `@tiptap/extension-*`（task-list / task-item / table / image / text-align / highlight / placeholder / text-style / subscript / superscript / link / code-block） | ^3.33.1 | MIT | 上述内核的扩展 |
| `prosemirror-*` | 随 `@tiptap/pm` 引入 | MIT | Tiptap 底层的文档模型与视图 |
| `@types/react` / `@types/react-dom` / `@types/turndown` | — | MIT | 类型 |
| `@vitejs/plugin-react` | 4.7.0 | MIT | 构建时 |
| `typescript` | 5.9.3 | Apache-2.0 | 构建时 |
| `vite` | 6.4.6 | MIT | 构建时 |

## Rust 直接依赖

数据来自 2026-11-12 对本地 cargo registry 中 `Cargo.toml` 的 `license` 字段实测。

| crate | 许可证 | 用途 |
| --- | --- | --- |
| `tauri` 2.12.5 / `tauri-build` 2.7.4 | Apache-2.0 OR MIT | 桌面壳 |
| `serde` / `serde_json` | MIT OR Apache-2.0 | 存档序列化 |
| `base64` 0.22 | MIT OR Apache-2.0 | 二进制导出 |
| `rfd` 0.17.2 | MIT | 原生保存对话框 |
| `ureq` 2.12 | MIT OR Apache-2.0 | 公开 URL 剪藏 |

## 传递依赖

`src-tauri/Cargo.lock` 记录 **461** 个 crate，`pnpm-lock.yaml` 记录完整前端依赖树。二者均随仓库提交。完整许可证审计请在本地执行：

```bash
cargo install cargo-deny && cargo deny check licenses bans advisories sources
npx license-checker --production --summary
```

## 不随二进制分发

- Node.js、pnpm、Rust 工具链：仅构建时使用。
- WebView2 Runtime：Windows 系统组件，由用户系统提供，本安装包不打包。
- NSIS：仅用于生成安装向导，便携版 zip 中不包含。
- 字体：使用系统字体栈，未内嵌任何第三方字体文件。
- 应用图标：`tools/make_icons.py` 用 Python 标准库自绘，无第三方素材。
