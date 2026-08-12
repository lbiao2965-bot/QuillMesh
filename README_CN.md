# QuillMesh 织墨

**面向人与 AI Agent 协作的本地优先 Markdown 编辑器。**

[English](README.md) · **简体中文**

QuillMesh 将接近 Typora 的所见即所得写作体验，与面向 Codex、Claude Code、脚本及其他外部工具的文件协作能力放进同一个桌面应用。它直接读写普通 `.md` 文件，不使用私有文档格式，也不要求把内容上传到云端。

> 当前版本：`0.2.1`。项目仍处于早期阶段，欢迎试用、反馈和共同完善。

<p align="center">
  <img src="assets/主页.png" alt="QuillMesh 主页" width="900">
</p>

## 为什么是 QuillMesh

在 Agent 工作流中，人和 AI 经常同时编辑同一份 Markdown：你在调整结构，Agent 在补充内容，脚本又可能刷新表格或数据。普通编辑器很容易静默重载、覆盖旧内容，或者让使用者自己判断哪一版才是最新的。

QuillMesh 把 Markdown 文件视为人与 Agent 的共享交付面：

* 监测外部修改；文档无本地改动时自动刷新。

* 本地编辑与外部修改重叠时弹出冲突对话框，不常驻占用编辑空间。

* 保存前校验磁盘 revision，避免旧内容覆盖新内容。

* 关闭标签页或窗口时统一检查未保存文档。

* Companion 修改先在 QuillMesh 中展示 Diff，接受后才写入。

## 功能概览

### 写作与阅读

* 所见即所得、源码模式和源码/预览双栏同步滚动。

* 多标签页、最近文件、同目录 Markdown 文件列表。

* 标题大纲、章节跳转、标题折叠和大纲拖拽调整章节顺序。

* 加粗、斜体、链接、引用、有序/无序/任务列表、高亮、行内代码。

* `Ctrl+Shift+P` 命令面板、`/` 快捷插入菜单和接近 Typora 的右键菜单。

* 任务集中视图，可筛选未完成任务并跳回正文位置。

<p align="center">
  <img src="assets/文件编辑.png" alt="QuillMesh 文档编辑、大纲与 Codex 状态" width="1000">
</p>

### 表格、代码和插入

* GFM 表格编辑、整表对齐、行列插入/删除和列宽拖动调整。

* 代码块一键复制、语言选择和自动换行。

* 插入图像、表格、代码块、公式、水平分割线及上下段落。

* 链接悬浮预览，并支持打开和复制链接。

<p align="center">
  <img src="assets/插入.png" alt="QuillMesh 插入菜单" width="760">
</p>

### 公式编辑

* 支持 LaTeX 行内公式与居中块公式。

* 编辑公式时实时预览渲染结果。

* 可在“编辑”菜单中启用或关闭块公式自动编号。

* Companion 可检查公式语法、布局与编号。

<p align="center">
  <img src="assets/公式编辑.png" alt="QuillMesh LaTeX 公式编辑与实时预览" width="760">
</p>

### 图片与资源

* 粘贴剪贴板图片时自动保存到文档旁的 `assets/` 目录，并写入相对路径。

* 拖动控制点调整图片显示尺寸，尺寸保留在 Markdown 中。

* 右键复制图片、复制路径或在资源管理器中显示。

* 点击图片进入大图预览；支持滚轮缩放和拖动查看。

<p align="center">
  <img src="assets/图片编辑.png" alt="QuillMesh 图片尺寸调整和任务视图" width="760">
</p>

### 文件安全与导出

* 外部修改监听、revision 冲突保护和自动保存开关。

* 长文档绘制保护，减少超长文件一次性渲染造成的卡顿。

* 导出 PDF、PNG、HTML 和 Word `.docx`。

* 中英文界面、自定义 CSS 主题和跨平台构建配置。

## Codex 协作

仓库内置 [QuillMesh Companion](plugins/quillmesh-companion/README.md)。安装并启用后，Codex 可以通过本地 MCP 直接读取 QuillMesh 当前文档、光标和选区，无需把 Markdown 正文复制粘贴到对话中。

典型用法：

1. 打开 QuillMesh 和需要处理的 Markdown。
2. 在 Codex 中输入“读取当前 QuillMesh 文档”“检查当前章节公式”或“润色我选中的内容”。
3. Codex 通过 Companion 获取所需上下文并保留当前 revision。
4. 修改前，QuillMesh 原位置显示逐段 Diff。
5. 你选择接受或拒绝；接受时再次校验 revision 后写入并刷新界面。

右上角 Codex 按钮和 `Ctrl+Shift+P` 命令面板提供“发送选区”“发送当前章节”“检查全文”等快捷入口。它们可以帮你生成操作指令；正文仍由 Companion 直接读取，不需要手动粘贴。状态栏会显示“Codex 已连接/未连接”。

Companion 还支持：

* 检查 Markdown 结构、公式、表格、引用和图片路径。

* 读取限定行范围，避免长文档一次性塞满上下文。

* 打开文件并定位标题或行号。

* revision 安全的精确替换和多段原子修改。

* 按明确请求导出 PDF、PNG、HTML 或 DOCX。

所有桥接通信仅监听 `127.0.0.1`，并使用随机 bearer token；文档不会上传到独立的 QuillMesh 云服务。

## 快速开始

### 安装包

仓库不直接提交打包产物。发布版本后，请从 [GitHub Releases](https://github.com/lbiao2965-bot/QuillMesh/releases) 下载安装包；也可以按下方命令从源码构建。

### 从源码运行

需要 Node.js 22.12 或更高版本。

```powershell
cd QuillMesh
npm install
npm run dev
```

构建应用：

```powershell
npm run build
```

生成安装包：

```powershell
npm run dist:win
```

默认构建产物位于 `release/`。

## 常用快捷键

| 操作       | Windows / Linux           | macOS        |
| -------- | ------------------------- | ------------ |
| 打开文件     | `Ctrl+O`                  | `⌘O`         |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` | `⌘S` / `⌘⇧S` |
| 关闭标签页    | `Ctrl+W`                  | `⌘W`         |
| 命令面板     | `Ctrl+Shift+P`            | `⌘⇧P`        |
| 搜索       | `Ctrl+F`                  | `⌘F`         |
| 加粗 / 斜体  | `Ctrl+B` / `Ctrl+I`       | `⌘B` / `⌘I`  |
| 链接       | `Ctrl+K`                  | `⌘K`         |
| 标题 1–6   | `Ctrl+1`–`Ctrl+6`         | `⌘1`–`⌘6`    |
| 源码模式     | `Ctrl+/`                  | `⌘/`         |
| 插入/编辑公式  | `Ctrl+Shift+E`            | `⌘⇧E`        |
| 插入图片     | `Ctrl+Shift+I`            | `⌘⇧I`        |
| 插入代码块    | `Ctrl+Shift+K`            | `⌘⇧K`        |

## 项目结构

```text
src/main/       Electron 主进程：窗口、文档会话、冲突保护、导出和本地桥接
src/preload/    类型化 IPC 边界
src/renderer/   Milkdown/ProseMirror 编辑器与应用界面
src/shared/     主进程和渲染进程共享类型与翻译
resources/      图标、演示文档和内置模板
themes/         示例 CSS 主题
plugins/        QuillMesh Companion Codex 插件与 MCP 服务
assets/         README 产品截图
```

进一步的实现说明见 [架构文档](docs/ARCHITECTURE_CN.md)。

## 开发与验证

提交修改前，请安装主程序与 Companion 的依赖，并运行统一验证命令：

```powershell
npm install
npm --prefix plugins/quillmesh-companion install
npm run verify
```

开发和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题的负责任披露方式见 [SECURITY.md](SECURITY.md)，签名发布要求见 [docs/SIGNING.md](docs/SIGNING.md)。

## 路线图

* 继续完善 CommonMark/GFM 与 Typora 常见写法的兼容性。

* 扩展长文档性能优化和跨目录资源管理。

* 完善 Companion 安装、Diff 审阅与更多 Agent 工作流。

* 发布 Windows、macOS 和 Linux 的可下载构建。

## 许可证与来源

QuillMesh 依 [MIT License](LICENSE) 开源。

QuillMesh 基于 [ColaMD](https://github.com/marswaveai/ColaMD) 修改并延伸。原始作品版权归 `marswave.ai` 所有；QuillMesh contributors 对各自新增和修改部分保留相应权利。请保留 [LICENSE](LICENSE) 和 [NOTICE](NOTICE) 中的原始版权及许可声明。
