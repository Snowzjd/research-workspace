# 项目内容 API 核对

界面不用开。本地 Agent HTTP 服务起来之后，用完整权限令牌。基地址默认 `http://127.0.0.1:7317`。数据与界面同一份：`%APPDATA%\个人科研工作台\workspace-data.json`（userData 下的 `workspace-data.json`）。

`folder` 是工作区根目录下的**相对文件夹名**。接口不复制文件，也不另存绝对路径。目录若在盘外，在这个相对名上建目录联接（junction）即可，软件打开时由系统跳过去。

## 字段

| 请求字段 | 落在项目上 | 不传时 |
| --- | --- | --- |
| `goal` | `goal` | 不变 |
| `subtitle` | `subtitle`（一句话简介） | 不变 |
| `intro` | `intro`（长简介） | 不变；传空串会清空 |
| `stage` | `stage`，并改当前流程节点的名称 | 不变 |
| `next_stage` | `next` | 不变 |
| `progress` | `progress`，0–100 的整数 | 无效值（空、NaN、`50%` 这种非数字）不写，**不会变成 50** |
| `display_name` | `displayName` | 不变；空串恢复成项目名 |
| `folder` 或 `folder_name` | `folder`（相对名） | 不变；带 `\`、`/` 或盘符会拒绝 |
| `nodes` | `nodes`，并同步 `flow` | 不变。未同时给有效 `progress` 时，进度改为「已完成节点 / 节点数」 |
| `plan` 或 `detailed_plan` | `plan`（详细计划，字符串数组） | 不变；`[]` 清空 |

节点可用 `{l,s,d}` 或 `{label,state,date}`。状态：`todo` / `current` / `done`，或「待开始 / 进行中 / 已完成」。

## 调用

```bash
# 精确读取
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:7317/api/projects/$PROJECT_ID"

# 部分更新。没写的字段保持原样
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "http://127.0.0.1:7317/api/projects/$PROJECT_ID" \
  -d '{"folder":"tpms_disk","plan":["补一组工况","写方法章"],"nodes":[{"label":"建模","state":"done"},{"label":"仿真","state":"current"}]}'

# 原有工具入口仍然可用
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "http://127.0.0.1:7317/api/tools/update_project" \
  -d '{"project":"'"$PROJECT_ID"'","progress":80,"stage":"多目标优化"}'
```

成功时响应含 `saved: true`、`changes` 和 `record`。马上再用同一个 ID `GET /api/projects/<id>`，`project` 应与刚才的 `record` 一致。

只读令牌可以 GET，PATCH 返回 403。

## 清空和拒绝

| 字段 | 未传 | 空值 | 非法值 |
| --- | --- | --- | --- |
| `progress` | 保持 | `null`、空串、`50%`、NaN：整单拒绝，不写成 50 | 同上 |
| `progress_mode` | 保持 | — | 只能是 `auto` 或 `manual`。`manual` 必须有 `progress_note` |
| `schedule` | 保持 | `null`：状态改为 `unconfirmed`，日期全部清空 | 日期必须是 `YYYY-MM-DD` 或 `null`。未核定不能带日期 |
| `period` | 保持 | 空串或 `null`：清空未核定周期 | 非空文本拒绝。正式区间走 `schedule` |
| `cover` | 保持 | `null`：回到类型占位 | `http(s)` 路径拒绝。本地路径不上传 |
| `intro` / `goal` / `subtitle` / `short_name` | 保持 | 空串清空 | — |
| `display_name` | 保持 | 空串恢复成项目名，不改 `id` 和 `folder` | — |
| `plan` | 保持 | `[]` 清空 | 非数组拒绝 |
| `folder` | 保持 | 空串拒绝 | 带斜杠或盘符拒绝 |
| 未知字段 | — | — | 整单拒绝，并列出字段名 |

`revision` 与当前修订不一致时返回 `code: "conflict"`，HTTP 409，不覆盖。`dry_run: true` 做校验和差异，不改修订、不落盘。

## 迁移

- 没有 `schedule` 的旧项目：原 `period` 文本抄到 `periodLegacy`，周期状态标为 `unconfirmed`，界面显示「周期待确认」，不猜测起止日期。
- 没有 `projectId` 的活动和待办保持未归属，不按当前项目补写。
- 节点补稳定 `id`。重排或改名时按 id 保留完成标准和证据。
- 负责人名字若是「研究员 / 我 / 空」，标成未确认，界面显示「待指定」，不计入已确认成员。
- 材料扫描默认「未扫描」。曹妃甸目录和 RAG 引擎目录只保留是否存在，不建立内容索引。

## 进度编辑窗

范围滑块在值为空或非法时，浏览器会把读数报成中点 **50**。保存时若用户没有拖动滑块，进度保持原值；拖动之后才把 0–100 的整数写回去。无效输入不会被自动存成 50%。

## 重启

退出再打开软件，或直接看 `workspace-data.json` 里该 `id` 的 `folder`、`nodes`、`plan`、`progress`、`goal`、`subtitle`。这就是界面读取的那份文件，不另有一份 Agent 存储。

自动化覆盖：`node --test tests/project-api.test.mjs tests/project-preview.test.mjs`（含部分更新、保存后再读、migrate 往返、非法进度整单拒绝且不落成 50、未知字段、修订冲突、dry_run、周期清空、封面、成果不删文件、活动/待办按项目隔离、卡片不再画完整流程、项目页纵向步骤）。

便携包要带上这次改动时，按仓库原有流程重新打 `app-update` / portable，不必改打包脚本。
