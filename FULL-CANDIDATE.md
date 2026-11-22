# Windows x64 正式便携版构建

在已提交的 Windows x64 正式源码目录中，使用 Node.js 22.12 或更新版本，并安装锁定的 Electron 45.4.1 分发。将 `RW_RCEDIT` 指向已核验的 Windows 资源编辑器，用于写入图标与 Windows 版本资源。

```powershell
$env:RW_RELEASE_COMMIT = (git rev-parse HEAD)
Push-Location desktop
npm.cmd ci
npx.cmd install-electron
npm.cmd run portable:full -- 'D:\ResearchWorkspace-4.0.0-build'
Pop-Location
```

对输出的 `portable-4.0.0` 目录从外层压缩。程序、`BUILD-INFO.json`、启动标记、`resources/app` 和许可证应保留相对位置。验收及用户指南见 [ACCEPTANCE-REPORT.md](ACCEPTANCE-REPORT.md) 与 [INSTALLATION-GUIDE.md](INSTALLATION-GUIDE.md)。
