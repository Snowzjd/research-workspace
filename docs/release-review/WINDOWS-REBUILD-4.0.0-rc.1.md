# Windows rebuild and verification for 4.0.0-rc.1

This procedure is for a clean checkout of the commit that contains this file. Record `git rev-parse HEAD` before building and refuse a dirty tree. The Electron 32.2.0 portable ZIP, its SHA-256 `0e2e145faf0a594e3e6f18fdcdf0bfb3ad5d5c5db0135d263c183adc211791ad`, and the earlier 162-pass report do not apply to this commit. This cloud workspace did not run the steps below.

Do not merge, tag, create a GitHub Release, run `install.ps1`, run `desktop/create-desktop-shortcut.ps1`, or replace an installed 3.2.x shortcut or `%APPDATA%\个人科研工作台`. The packer does not Authenticode-sign. A successful build is still unsigned.

## Build machine

- Windows x64.
- Node.js 22.12.0 or newer. Electron 45.4.1 refuses an older Node for its npm package. The runtime embedded in Electron is Node.js 24.22.3; that is not the Node that runs the packer.
- Network access to the npm registry and GitHub releases, unless `desktop/node_modules/electron/dist` is already the verified 45.4.1 Windows distribution.
- Optional: the same reviewed `rcedit` binary as before. Recompute its SHA-256 on this machine. The historical value `ab53500d556fd824636621bca7dbecd8583ba181891c3e9efdcf16b72a28b0cd` is a claim from the old build, not a result of this commit.
- Python and the RPM skill are needed only for the RPM tests. Codex is needed only for the local Codex test. Neither is needed to pack.

## Isolated paths

Pick a fresh parent that does not exist yet, for example `D:\rw-rc1-build\<commit>`. Do not use:

- the installed 3.2.x directory
- `%APPDATA%\个人科研工作台`
- `%LOCALAPPDATA%\ResearchWorkspace`
- `G:\TPMS`
- `F:\Obsidian\Research_Vault` or any other live vault
- the source checkout itself

The packer writes `<parent>\portable-4.0.0-rc.1` and refuses to overwrite that name. The candidate then keeps its own data in `<parent>\portable-4.0.0-rc.1\candidate-user-data`. Leave `RW_VAULT_ROOT` unset for the pack and for automated launch tests. When the native directory picker is tried by hand, choose a new empty directory created for that try.

The candidate listens on `127.0.0.1:17400` only. It refuses `--data-dir`, `--api-port`, `--no-sandbox`, and the probe switches. Do not add those arguments.

## Pack

From the clean checkout:

```powershell
git status --porcelain
git rev-parse HEAD
Push-Location desktop
npm.cmd ci
npx.cmd install-electron
if ($env:RW_RCEDIT) { Get-FileHash -Algorithm SHA256 -LiteralPath $env:RW_RCEDIT | Format-List }
npm.cmd run portable:full -- 'D:\rw-rc1-build\<commit>'
Pop-Location
```

`npm ci` does not download Electron. `npx install-electron` does, into `desktop\node_modules\electron\dist`. On this Windows machine that download must be the win32-x64 build. Confirm `desktop\node_modules\electron\dist\version` is exactly `45.4.1` before packaging.

If `RW_RCEDIT` is set, the PE file and product versions become `4.0.0.1` and the product version string stays `4.0.0-rc.1`. If it is unset, the executable is still the renamed Electron binary and will not carry those version resources. Say which case the evidence came from. Do not describe either case as signed.

## Evidence to record

Under the fresh portable directory:

- The portable root `version` file reads `45.4.1`. `resources\app\package.json` has `"version": "4.0.0-rc.1"` and `"fullCandidate": true`.
- `resources\app\LICENSE` contains `Copyright (c) 2026 Snowzjd` and the MIT permission paragraph.
- The portable root `LICENSE` is the Electron license (`Copyright (c) Electron contributors`). It must not be the Snowzjd file.
- `LICENSES.chromium.html` and `THIRD-PARTY-NOTICES.md` are at the portable root. The notices name Electron 45.4.1.
- `libEGL.dll` and `libGLESv2.dll` are absent. `dxcompiler.dll`, `vk_swiftshader.dll`, `ffmpeg.dll`, and `ResearchWorkspace.exe` are present.
- `FULL-CANDIDATE-PORTABLE.txt` exists beside the executable and under `resources\app`.

Hash the new artifacts. Do not expect the old ZIP hash.

```powershell
$portable = 'D:\rw-rc1-build\<commit>\portable-4.0.0-rc.1'
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $portable 'ResearchWorkspace.exe')
Get-ChildItem -LiteralPath $portable -Recurse -File | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLower()
  $relative = $_.FullName.Substring($portable.Length).TrimStart('\')
  '{0}  {1}' -f $hash, $relative
}
```

Zip only after those hashes are recorded, from outside the portable directory, and hash the zip too. Keep the candidate directory for the launch tests; test a clean copy when a script requires an empty `candidate-user-data`.

## Verification

Run the source suite from the checkout with the Windows tools available. Separate passes, failures, and skips in the saved log.

```powershell
$env:RPM_TEST_PYTHON = (Get-Command python).Source
node --test --test-concurrency=1 (Get-ChildItem tests -Filter '*.test.mjs').FullName
```

Set `RPM_TEST_SCRIPT` only when the live RPM tests should run, and point it at the skill's `rpm.py`, not at a project directory. Do not export `RESEARCH_WORKSPACE_QA_CODEX` until the Codex section below. The cloud run of this command, without those Windows tools, was 147 pass, 17 fail, 1 skip. A Windows run should be compared with that split, not treated as a rerun of the old 162-pass report.

Then, against a clean copy of the new portable directory:

```powershell
powershell.exe -NoProfile -File tests\full-start-cmd.ps1 -Candidate '<clean-extract>'
node tests\full-packaged.mjs fixture '<clean-extract>' '<new-evidence-dir>'
node tests\rc-specialized.mjs '<clean-extract>' '<new-screenshot-dir>' '<new-empty-temp-parent>' '<RPM-skill-dir>'
```

`rc-specialized.mjs` creates its own fixture room and vault under the temp parent. Pass the RPM skill directory as the last argument. Do not pass `G:\TPMS` or the live Obsidian vault as any of the four paths. The metadata-only guard for `G:\TPMS` stays in the program; this test does not need to write there.

For local Codex, use a disposable project root and the evidence JSON the existing script already accepts. Do not point it at a real notes directory or a live research project:

```powershell
$env:RESEARCH_WORKSPACE_QA_CODEX = (Get-Command codex).Source
node tests\full-packaged.mjs codex '<clean-extract>' '<new-evidence-dir>' '<isolated-codex-evidence.json>'
```

Manual gates after those commands, each on the new unsigned build:

- Native Vault picker: choose a newly created empty directory, restart, and confirm the candidate did not open `G:\TPMS` file bodies or the daily AppData directory.
- One-time import: import a copy of a workspace JSON in a disposable candidate directory, not the live 3.2.x data file.
- Cross-device use remains uncovered until a second machine exists.
- Confirm `http://127.0.0.1:17400/api/health` reports `"version":"4.0.0-rc.1"` and `"port":17400`.

Stop there. Hashes, logs, and the manual notes are the acceptance evidence for this commit. They do not by themselves publish the pre-release.
