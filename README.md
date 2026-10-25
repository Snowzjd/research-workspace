# 个人 AI 科研工程工作台

**Personal AI Research & Engineering Workspace**

一个**独立的 Windows 桌面软件**：项目管理、任务流、科研知识库、工程软件启动器、AI Agent 调度，全部在一个工作空间里运行。

## 下载

到 [Releases](../../releases/latest) 下载 `ResearchWorkspace-portable-x.y.z.exe`，双击即用，免安装。

- 数据只存在本机（`%APPDATA%\个人科研工作台\`），exe 不含任何项目数据
- 新设备打开就是空工作台（只有标准模板），按引导建立身份、绑定云端
- 多设备同步：坚果云（WebDAV 直连）/ 本地目录，三方合并 + 冲突逐条确认
- 应用内更新：每次升级只下载约 1MB 的增量包，自动完成替换与重启

## 主要能力

- **项目 / 任务**：首页是项目总览，任务在项目内；阶段流与材料目录随项目走
- **AI Agent**：内置 18 个可操作数据的工具，所有写操作可审计、可撤销；支持外部 Agent（MCP）接入
- **知识库**：资料登记 + 可选接入自建 RAG 服务
- **工程软件启动**：Fluent / Tecplot 等本地软件一键启动、进程查看
- **数据安全**：每日自动备份（保留 7 份）、交接文件导出导入、本机解锁密码（scrypt + 系统加密凭证）

## 技术形态

Electron + 原生 HTML/CSS/JS（零构建）。MIT License。
