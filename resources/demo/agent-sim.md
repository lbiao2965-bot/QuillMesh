# Agent 实时同步演示

这是 QuillMesh 的核心工作流：外部程序修改当前 Markdown 文件，编辑器检测磁盘变化并安全协调。

## 测试自动更新

先保存这份文档，再在 PowerShell 中运行：

```powershell
Add-Content -LiteralPath '<文档路径>' -Value '- Agent 新写入的内容'
```

当前文档不脏时，新内容将自动出现。

## 测试冲突保护

1. 在 QuillMesh 中输入一行，但不保存。
2. 再从终端向同一文件写入内容。
3. 冲突对话框会让你比较并选择保留哪个版本。

不要在含有重要内容的唯一副本上进行冲突测试。
