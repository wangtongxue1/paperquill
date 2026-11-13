# 开源前准备清单

> 基于 2026-11-12 对当前仓库的**实际体检**，不是通用模板。结论、数字、路径都来自本仓库。
>
> **状态（2026-11-12 收盘）：名字已定「纸间笔记」、主许可证已选 Apache-2.0，P0 阻塞项已全部处理，交付物已重编重打包。** 下文保留体检原始记录与判断依据，便于回溯。

## 一、结论先行

**开源不推翻前面的架构判断，反而强化它。** 纯文本落盘、无账号、无云同步，正是开源笔记项目最难被质疑的信任资产；换成 Notion 式块模型，等于把用户数据锁进一份私有 schema，fork 和自用都失去意义。

但开源会新增三类以前不存在的硬约束：

1. **数据格式从内部实现变成公共契约**——别人会写脚本读你的 `workspace.json`，会依赖你的镜像文件命名，格式一改就是 breaking change。
2. **分发风险高于自用**——剪藏 / URL 抓取 / 书签小工具在"自己用"和"公开分发"两种情形下的责任完全不同。
3. **品牌与许可从"无所谓"变成"第一位"**——当前项目名已有同类商业产品在用，这是最急的一件事。

---

## 二、体检结果（已实测）

| 检查项 | 实测结果 | 处置 |
| --- | --- | --- |
| 前端直接依赖许可证 | 15 个：MIT / ISC / Apache-2.0 为主；`dompurify` = `(MPL-2.0 OR Apache-2.0)`；`jszip` = `(MIT OR GPL-3.0-or-later)`；`typescript` = Apache-2.0 | 无强 copyleft 强制；两个双许可包必须**显式声明选用哪个分支** |
| Rust 直接依赖许可证 | `tauri` / `tauri-build` / `serde` / `serde_json` / `base64` / `ureq` 均为 `MIT OR Apache-2.0`，`rfd` = MIT | 与主许可证兼容 |
| 传递依赖规模 | `Cargo.lock` 共 **461** 个包，`pnpm-lock.yaml` 已存在 | 需要 `cargo-deny` / license-checker 出全量清单，不能只看直接依赖 |
| LICENSE / NOTICE / THIRD_PARTY_NOTICES | 原为**全部缺失** | **已补齐**：`LICENSE` 为官方 Apache-2.0 全文（含附录）、`NOTICE` 写明版权主体、`THIRD_PARTY_NOTICES.md` 列全直接依赖与双许可选择 |
| CHANGELOG / CONTRIBUTING / SECURITY / CI | 原为**全部缺失** | **已补齐**；issue / PR 模板与行为准则未加，列为待办 |
| 硬编码本机路径 | 原 `tools/package.py` 注释含本机绝对路径，输出目录依赖父目录 | **已修**：`ZHIJIAN_OUT` 环境变量 / 命令行参数可覆盖，注释去掉绝对路径 |
| 发布主体占位 | 原 `com.inknote.desktop` / `inknote project` | **已替换**：`com.zhijian.desktop`、publisher / copyright = `The ZhiJian Authors` |
| 图标 | `tools/make_icons.py` 纯标准库自绘，已覆盖早期临时复用的 rustify 图标 | 无第三方版权问题，保留生成脚本便于复现 |
| 示例内容 | `data.ts` 一段「摘抄」实为项目自写 | **已修**：标注为「大意（我的转述，非书中原文）」 |
| 存档格式 | 原 `WORKSPACE_VERSION` 只是常量，无 `migrate()`、无 schema 文档 | **已补**：`src/storage.ts` 的 `migrate()` + `docs/data-format.md` + `tools/verify_migrate.mjs`（6 组断言，含 v1→v2） |
| 名称 | **高碰撞**，已定改名「纸间笔记」 | **已执行**：代码 / 文案 / identifier / 交付物文件名全量替换；旧数据目录做复制迁移 |

---

## 三、P0 阻塞项（已全部处理）

### 3.1 名称与商标（已决：改名「纸间笔记」）

**决策（2026-11-12）：新名字定为「纸间笔记」，并已执行全量替换。** 下面的检索证据保留作为改名依据。
已替换：产品名、logo 单字、窗口标题、HTML title、`com.zhijian.desktop`、crate / npm 包名、publisher / copyright、示例笔记与内链、导出文件名、使用说明、交付物文件名。

公开检索到的同名 / 近似同类产品：

- **墨记日记**（moji365.com）：全平台商业日记应用，Windows / macOS / 安卓 / 鸿蒙 / iOS，含云同步。
- **「墨记-精美日记本·笔记本」**（App Store id1221871966）：约 12 万评分，版权标注「© 墨记」，有会员订阅。
- **「墨记 Ink Diary」**：已有 MIT 开源的本地日记应用。
- 另有 GitHub 项目把「墨记 / 墨記 / 墨计」列为**发布门禁禁用名**，理由正是公开市场同名应用高碰撞。

同名 + 同类目（笔记 / 日记）+ 商业产品在先，公开分发容易造成来源混淆。这不是法律意见，我没做商标数据库检索；但风险足够高，**建议开源前换名**，并把「商标检索 → GitHub 仓库名 → 域名 → 应用商店同类目」做成命名门禁。

当前英文标识用 `zhijian`（`com.zhijian.desktop`），**公开仓库前仍需**在 GitHub / npm / crates.io 三处查占用。注意：**改名字不等于拿到商标权**，Apache-2.0 第 6 条明确不授予商标，要保护「纸间笔记」这个品牌仍需另行做商标检索与注册；`NOTICE` 里已写明这一点。

**改名的数据兼容处理**：identifier 变化会让 `app_data_dir()` 指向新目录，因此 `src-tauri/src/main.rs` 在启动时把旧 `com.inknote.desktop` 的 `workspace.json` 与 `notes/` **复制**到新目录（只复制、不删除，可回退）；浏览器模式的 IndexedDB 库名 `inknote` 与 localStorage 键 `inknote.workspace` 刻意保留旧名。这些属于数据契约，不是品牌文案。

### 3.2 许可证与归属

**已选 Apache-2.0（2026-11-12 拍板）。** 理由：带明确的专利授权条款，企业采用顾虑小；第 6 条明确不授予商标权，对刚定下的品牌名更清楚；第 5 条贡献条款让 PR 授权归属清晰；与 `dompurify` 可选分支一致。

已完成：

1. `LICENSE` 为官方 Apache-2.0 全文（含 APPENDIX），`NOTICE` 写明 `The ZhiJian Authors` 与商标保留。
2. `THIRD_PARTY_NOTICES.md` 显式声明 **DOMPurify 取 Apache-2.0 分支、JSZip 取 MIT 分支**，避开 GPL-3.0 分支。
3. 直接依赖与许可证逐项列出；461 个传递依赖以 `Cargo.lock` / `pnpm-lock.yaml` 为准，全量 `cargo-deny` 审计列为后续动作。

### 3.3 数据格式即契约

**已补齐。** 原先 `WORKSPACE_VERSION` 只是常量、`load()` 直接 `JSON.parse`，没有迁移与 schema 文档；现在：

- `docs/data-format.md`：顶层 / Note 字段、类型与缺省值、镜像命名规则（`<slug>-<id 后 6 位>.<ext>`）、兼容承诺、最小 fixture。
- `src/storage.ts` 的 `migrate()`：未知字段原样保留、只补默认值、解析失败抛错。
- `src/App.tsx` 的 `fatalError` 分支：存档损坏时**不 seed、不写盘**，避免用示例数据覆盖用户笔记。
- `tools/verify_migrate.mjs`：6 组断言（默认值、未知字段、老笔记补字段、已有值不改写、v2 字段与自定义侧栏保留、损坏输入抛错），CI 与本地同跑。
- **2026-11-12 v2.0.0**：`WORKSPACE_VERSION` 升到 2，新增快捷方式 / 保存的搜索 / 笔记历史 / 侧栏配置 / 即时贴等字段；v1 存档只补默认值、不改 `Note` 结构，启动时写回一次。详见 `docs/data-format.md` 与 `docs/adr/0006`。
- 承诺：**任何版本都不会静默改写用户磁盘上的笔记文件**。

### 3.4 剪藏与分发合规边界

**已写入 `SECURITY.md`**（分发比自用风险大得多），并在 `docs/adr/0004-剪藏不做浏览器扩展.md` 记录决策：

- 不内置任何第三方站点的解析规则、账号体系或内容适配；不打包任何第三方内容。
- `fetch_clip` 只抓用户主动输入的公开 URL，且已挡掉 localhost / 内网 / 云元数据地址，保持这个防护。
- 书签小工具只复制选中内容到剪贴板，不向页面注入常驻脚本。
- 不提供规避技术保护措施的能力，不做任何平台的解锁 / 绕过接口。
- 明确「URL 抓取由使用者自行判断目标页面的授权与 robots 约定」。

---

## 四、P1：仓库工程化（大部分已补齐）

| 项 | 具体动作 |
| --- | --- |
| 锁文件 | 提交 `Cargo.lock`（二进制 crate 应提交）与 `pnpm-lock.yaml`；CI 用 `--locked` / `--frozen-lockfile` |
| 依赖审计 | `cargo-deny check licenses/bans/advisories/sources`；前端加 license-checker；Dependabot 或 Renovate 开自动更新 |
| CI | Windows runner 跑 `pnpm build` → `cargo build --release` → `cargo test` → `tools/make_singlefile.py` → `tools/package.py`，产物上传 artifact；另加一个 Linux job 只跑前端类型检查与单文件生成 |
| 可复现构建 | 固定 Node / Rust 版本（当前 Node 22.22.2、Rust 1.99.1、pnpm 12.11.2），写进 `CONTRIBUTING.md` |
| 发布流程 | `CHANGELOG.md` + 语义化版本 + 每个 release 附 `SHA256SUMS.txt`，条件允许再做签名；`package.py` 里已经产出校验和，接进流程即可 |
| 贡献流程 | `CONTRIBUTING.md`（构建、代码规范：注释/日志/错误信息用简体中文，标识符英文）、issue / PR 模板、行为准则 |
| 架构决策记录 | `docs/adr/`：① 为什么不用块模型 ② 为什么纯文本落盘 ③ 为什么双模式单一真相 ④ 为什么剪藏不做浏览器扩展。省得每个新贡献者再提一遍 |
| 安全响应 | `SECURITY.md`：漏洞报告渠道、剪藏边界、不收集遥测的承诺 |

---

## 五、P2：可以慢慢做

- 示例数据脱敏：当前示例笔记里出现真实书名与作者，作为示例引用没问题，但可换成虚构书目更干净。
- 跨平台：`open_data_dir` / `open_url` 目前是 Windows 分支为主，安装包也只有 NSIS。开源后要么补齐 macOS / Linux，要么在 README 如实写「目前仅 Windows 打包」。
- 演示截图、GIF、公开 issue 里的复现档模板。
- 去掉已不再使用的 `@tauri-apps/api` 依赖（前端已改为直接走 `__TAURI_INTERNALS__.invoke`），`@tauri-apps/cli` 保留给 `pnpm tauri`。

---

## 六、决策与执行记录（2026-11-12）

| 项 | 决策 | 状态 |
| --- | --- | --- |
| 新名字 | **纸间笔记** | 已全量替换，并做旧数据目录迁移 |
| 主许可证 | **Apache-2.0** | LICENSE / NOTICE / 第三方声明已补齐 |
| 数据格式契约 | `migrate()` + schema 文档 + 回归断言 | 已补齐 |
| 工程化 | CONTRIBUTING / SECURITY / CHANGELOG / CI / 四篇 ADR | 已补齐 |
| 重编与交付 | 桌面版 exe、单文件 HTML、便携 zip、SHA256 | 已完成 |

**仍需人工完成的**：公开仓库前查 `zhijian` 在 GitHub / npm / crates.io 的占用；商标检索与注册（许可证不保护品牌）；`cargo-deny` 全量传递依赖审计；issue / PR 模板与行为准则；CHANGELOG 末尾的仓库链接占位符；`@tauri-apps/api` 未使用依赖的清理。

> 变更记录：`src/data.ts` 虚构引文标注修正 → 新增本清单 → 名字与许可证拍板 → 全库改名 + 数据目录迁移 + `migrate()` + 法律/工程文件 + CI/ADR → 重编重打包。
> 旧版（旧名）交付物仍留在 `output/inknote/`，未删除；新版在 `output/zhijian/`，两者数据互不相干，旧目录里的真实笔记不会被改名迁移影响（迁移只复制、不移动）。
