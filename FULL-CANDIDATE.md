# 科研工程工作台 4.0.0-rc.1 full candidate

This is a Windows x64 portable candidate. Extract the ZIP to a writable folder, then run `start.cmd` or `ResearchWorkspace.exe`. Keep the adjacent marker and `resources/app` together. Use a normal writable directory. The workbench window and the local project API use the candidate’s own state. The API binds only to `127.0.0.1:17400`. If that port is occupied, the window can still open with a disconnected API status.

## First use and migration

The candidate opens the RPM graph. The local project and task list starts empty. To reuse workbench records, choose **导入工作台数据** and select a `workspace-data.json` or a workbench JSON backup. The native confirmation shows that this replaces the candidate’s records. The original stays in place. Prior candidate records, when present, are stored under `candidate-user-data/migration-backups`. The import accepts the workbench record file only. Local device configuration, tokens and credentials are outside the import.

To associate a workbench project with a registered RPM project, select the RPM entry in that project’s controls. The candidate reads the registered root and verifies its real path. The workbench does not create an RPM project. Project data, tasks, stages and milestones use `candidate-user-data/workspace-data.json`. Codex execution evidence uses `candidate-user-data/codex-executions.json`. The original RPM records remain their own read-only metadata source.

## Shared notes and search

The notes workspace opens existing Markdown originals in `F:\Obsidian\Research_Vault` and in verified RPM project roots. The notes UI shows external edits and rejects a stale save. Save and restore each preserve the replaced bytes in `candidate-user-data/markdown-versions`. Use the note’s version picker to restore one version. Markdown backups contain local note contents. Keep this directory local.

Files in the official `G:\TPMS` project are available as RPM metadata. Its file bodies and originals are excluded from the candidate’s file-opening and note-writing paths. Hidden files, links, RPM management records and legacy `TASKS.md` are excluded from the Markdown editor.

Global search covers structured workbench records, indexed RPM files and relationships, and Vault file names. RAG full-text search and knowledge-base service lifecycle are deferred for this candidate.

## Codex task collaboration

Use the local Codex CLI under the same Windows account. The dashboard and the task detail discover pending sessions belonging to the registered RPM project root or a verified project subdirectory. Review the session directory, name when available, and timestamp in the task detail, then explicitly bind it. Nested registered projects, redirected and administrative directories, skill directories and metadata-only projects are excluded. One session is bound to one workbench task. Local session directory notifications trigger structured App Server snapshot reconciliation. A 12-second periodic check and manual refresh remain available. No session log content is opened by the watcher. Closing the workbench stops its local reader.

To start from the workbench, enter the task requirements and acceptance criteria, then select **复制 Codex 交接** in the task detail. Use **复制资料 ID** in a material detail or **复制节点 ID** in a graph inspector to obtain stable reference IDs. Optional references are checked against the current RPM project at handoff. Paste the draft into Codex at the registered root and explicitly start or continue a session there. Return to the task to bind the session. The candidate does not remotely start, pause, cancel or write to Codex sessions. The App Server reader opens no listening port.

Execution status, structured change records, test-command exit codes and workbench acceptance are displayed separately. Reported files stay under the project root. Codex progress does not edit the authoritative task status, RPM registry, Obsidian notes or knowledge graph. Keep the execution JSON local. See the delivery report for verified coverage and current connection limits.

## Build from source

Use Windows x64 and Node.js 22.12 or newer. The pinned runtime is Electron 45.4.1. Electron 42 and newer do not download that runtime during `npm ci`; run `npx install-electron` on the Windows build machine before packaging. Provide the already installed RPM Skill and Python for RPM integration; both come from the existing local environment. The candidate resolves the installed RPM defaults or trusted launch-environment `RPM_PYTHON`, `RPM_SCRIPT`, and `RPM_SETTINGS`.

```powershell
Push-Location desktop
npm.cmd ci
npx.cmd install-electron
npm.cmd run portable:full -- 'D:\path\to\a\fresh-output-parent'
Pop-Location
```

The output parent must be a new writable directory. Do not use the installed 3.2.x directory, `%APPDATA%\个人科研工作台`, `G:\TPMS`, or the Obsidian vault. An existing Electron 45.4.1 installation under `desktop/node_modules/electron/dist` can be reused for an offline build only when its `dist\version` file says `45.4.1`. When an approved local Windows resource editor is available, set `RW_RCEDIT` to its absolute executable path before packaging to embed Windows icon and version metadata. The packer creates a fresh `portable-4.0.0-rc.1` directory. It stops if that name already exists in the chosen parent. The Windows rebuild steps and the evidence to record are in `docs/release-review/WINDOWS-REBUILD-4.0.0-rc.1.md`. This source revision has not itself been packed on Windows.

## Rollback

Exit the candidate and continue using the existing daily shortcut. Preserve the candidate data directory if you want to retain its records, Codex bindings, execution evidence or note versions. Restore the matching workspace and execution JSON together while the candidate is closed. To undo a candidate data import, use the same import dialog and choose the appropriate file from `migration-backups`. Reverting the executable has no effect on Markdown originals saved through the editor. Use the original note’s version picker to undo those edits.
