# 安装与使用

## 首次启动

1. 从 [4.0.0 正式发布页](https://github.com/Snowzjd/research-workspace/releases/tag/v4.0.0) 下载 Windows x64 ZIP 和 `SHA256SUMS.txt`。
2. 在 PowerShell 运行 `Get-FileHash -Algorithm SHA256 .\ResearchWorkspace-4.0.0-Windows-x64.zip`，与清单相同后解压到新的可写目录。
3. 双击 `start.cmd` 或 `ResearchWorkspace.exe`。保留解压出来的所有文件在原相对位置。首次启动的工作区可以为空。正式数据位于程序同级 `portable-user-data`。
4. 需要接续旧数据时，先阅读《迁移指南》。程序不创建或移除已有快捷方式。需要固定入口时可自行创建指向新目录的快捷方式。

## 本机工具

工作台自身包含 Electron 运行时。知识工作区可选择已有 Markdown Vault，安装 Obsidian 后两者可编辑同一原件。RPM 接入需要本机已安装的 RPM 2.0、Python 与 PyYAML，以及含绝对 Vault 路径的 RPM 配置。程序会查找用户独立安装的 RPM；可用可信的 `RPM_SCRIPT`、`RPM_PYTHON` 和 `RPM_SETTINGS` 指定安装。Codex 协作需要同一 Windows 账户下可用的本机 Codex。软件与文件读取之外的写入由确认及各工具本机策略控制。

工作台的本机接口监听 `127.0.0.1:17403`。便携版本当前未做 Authenticode 签名。解压后可将目录保留在自己的本机工作区。
