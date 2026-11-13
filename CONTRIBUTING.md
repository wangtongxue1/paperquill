# 参与开发

## 环境与版本

| 工具 | 版本（2026-11-12 实测） |
| --- | --- |
| Node.js | 22.22.2 |
| pnpm | 12.11.2 |
| Rust / cargo | 1.99.1 |
| Tauri | 2.12.5 |
| WebView2 | Windows 系统自带 |

Windows 为目标平台；macOS / Linux 目前只保证前端可构建。

## 起步

```bash
pnpm install --frozen-lockfile
pnpm dev                  # Vite dev server, http://127.0.0.1:1420
pnpm tauri dev            # 完整桌面壳（需要 WebView2）
```

## 每次提交前

```bash
pnpm build                # tsc --noEmit + vite build
node tools/verify_migrate.mjs    # 存档迁移回归断言
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml
python tools/make_singlefile.py
python tools/package.py
```

`cargo build --release` 必须带 `custom-protocol`（已是默认 feature），否则 exe 会去连 devUrl 显示白页。

## 代码规范

- **注释、日志、错误信息、API 消息、文档用简体中文；代码标识符用英文。**
- 前端：React 18 + TypeScript strict，函数组件 + Hooks，样式集中在 `src/styles.css`，颜色一律走 CSS 变量。
- Rust：只负责文件、导出、剪藏、窗口控制；**业务逻辑不要下沉到 Rust**。
- 数据操作统一走 `src/actions.ts` 的 `mutate`，不要在组件里直接改 `ws`。
- 新增存档字段必须同时更新 `src/types.ts`、`src/storage.ts` 的 `migrate()` 与 `docs/data-format.md`，并提升 `WORKSPACE_VERSION` 时补迁移分支。
- 破坏存档格式的变更必须给显式迁移路径，**不允许静默丢弃未知字段或改写用户文件**。

## 验收

- UI 走无头浏览器截图（同一份 dist）：`?note=N / ?dialog=… / ?theme=dark / ?q=… / ?view=card` 是预览钩子。
- 交互验收用注入探针 + `--screenshot`；`--dump-dom` 下 React 异步调度不推进，读不到挂载结果。
- 桌面端非交互会话的 PrintWindow 抓图右缘可能有裁切假象，只做「启动 + 窗口标题 + 数据落盘」冒烟验收。

## 提交与 PR

- 提交信息用简体中文，一句话说明「改了什么 + 为什么」。
- PR 描述里写清是否触碰存档格式、是否需要数据迁移、是否有新增依赖（新增依赖要同步 `THIRD_PARTY_NOTICES.md`）。
- 架构级取舍先写 ADR（`docs/adr/`），再动代码。
- 提交 PR 即表示你同意按 [Apache-2.0 第 5 条](https://www.apache.org/licenses/LICENSE-2.0#contributions) 授权你的贡献。

## 发布

版本号同步 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`，更新 `CHANGELOG.md`，CI 产物附 `SHA256SUMS.txt`。
