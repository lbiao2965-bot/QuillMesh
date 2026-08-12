# QuillMesh Companion for Codex

QuillMesh Companion is a local-first bridge for reading and safely editing Markdown with Codex while QuillMesh remains the interactive editor.

## What it does

- Reads the active QuillMesh document, cursor, selection, editor mode, dirty state, and disk revision.
- Opens Markdown files in QuillMesh and locates an exact heading or approximate line.
- Inspects document structure and reads bounded line ranges without flooding model context.
- Checks formula syntax and numbering, Markdown tables, block quotes, image paths, and image alternative text.
- Shows exact before/after paragraph Diffs inside QuillMesh before any reviewed write.
- Applies accepted edits only when the SHA-256 revision still matches, preserving external-change conflict protection.
- Refreshes an open clean QuillMesh document after an approved or direct revision-safe write.
- Exports PDF, PNG, HTML, and Word DOCX to an explicit path when requested.
- Sends a five-second local heartbeat so QuillMesh can show the live Codex connection state.

## QuillMesh interaction

Once Companion is active, Codex reads the current document, cursor, and selection directly over MCP. The upper-right Codex menu and `Ctrl+Shift+P` command palette provide selected-text, current-section, and full-document shortcuts. They may generate an operation prompt, but the Markdown body does not need to be pasted into Codex. When Codex submits a reviewed edit through Companion, QuillMesh marks a pending Diff prominently and waits for an explicit accept or reject decision.

Example prompts:

- `Read the current QuillMesh document and summarize this section.`
- `Check the formulas in the current QuillMesh section.`
- `Rewrite my current QuillMesh selection and show a Diff before writing.`

## Preview boundary

Companion does not replace or modify Codex's built-in Markdown file preview. The plugin intentionally does not expose formula cards, full-document image previews, or local document images in the Codex conversation. Formula rendering stays in QuillMesh; Codex receives structured validation results and document context.

## Local bridge

The live bridge listens only on `127.0.0.1` and requires a random 256-bit bearer token stored in QuillMesh's user-data directory. Document data is not sent to a hosted bridge.

## Development

```powershell
npm install
npm run build
npm test
```

## 中文说明

QuillMesh Companion 是连接 Codex 与 QuillMesh 的本地 Markdown 协作桥接插件，重点是读取上下文和安全修改，而不是在 Codex 对话中重复实现预览器。

它可以：

- 读取 QuillMesh 当前文档、光标、选区、编辑模式、未保存状态和磁盘修订；
- 打开 Markdown 文件并定位标题或行号；
- 检查公式语法与编号、表格列数、引用、图片路径和替代文本；
- 修改前在 QuillMesh 中展示精确的逐段 Diff；
- 用户接受后才写入，并在写入前再次核对 SHA-256 revision；
- 检测外部修改冲突，拒绝使用过期 revision 强行覆盖；
- 修改成功后通知 QuillMesh 刷新；
- 按明确请求导出 PDF、PNG、HTML 或 Word DOCX。
- 每五秒发送一次本地心跳，让 QuillMesh 显示实时 Codex 连接状态。

Companion 在线时，Codex 会通过 MCP 直接读取 QuillMesh 当前文档、光标和选区，不需要把 Markdown 正文复制粘贴到对话中。QuillMesh 右上角 Codex 菜单和 `Ctrl+Shift+P` 命令面板提供“发送选区”“发送当前章节”“检查全文”等快捷入口；这些入口可以生成操作指令，但正文仍由 Companion 读取。Codex 发回修改后，QuillMesh 会醒目标记待处理 Diff，并等待用户明确接受或拒绝。

Companion 不会替换 Codex 自带的 Markdown 文件预览器，也不再向 Codex 对话返回公式卡片、完整文档截图或本地图片。公式和排版预览继续由 QuillMesh 负责。
