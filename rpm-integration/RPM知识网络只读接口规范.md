# RPM 2.0 知识网络只读接口规范

接口版本 **1**。交付包含只读查询脚本、复用现有阶段三适配器的 CommonJS 客户端、JSON Schema、可复建的隔离测试数据和验收脚本。

## 1. 实际 RPM 数据来源

| 数据 | 权威文件和处理方式 |
| --- | --- |
| 项目身份与实际根 | 中央 Vault 的 `.rpm/projects.json` 提供登记范围，根目录的 `00_Project_Management/PROJECT_CONFIG.yaml` 确认项目 ID、名称、类型、方向和真实根。 |
| 项目摘要、状态、阶段 | PROJECT_README.md 的「项目介绍」，PROJECT_STATUS.md 的 YAML 属性和正文。空状态和阶段返回 `null`。 |
| RPM 任务 | TASKS.md 的 YAML `tasks`。状态为 `todo`、`doing`、`done`，依赖使用同一项目内的任务 ID。工作台自己的任务库仍独立维护。 |
| 文件索引 | FILE_INDEX.csv。返回完整索引，包括失效行及在场判断。沿用当前安装的 RPM 索引校验。 |
| 文件关系 | `00_Project_Management/.rpm/relations.json`。字段为 `source`、`target`、`kind`、`evidence`。FILE_RELATIONS.md 是它的展示。 |
| 研究方向 | 项目配置中的 `direction`。来源为配置文件，README 中记录同一方向时也作为来源。 |
| 其他知识节点 | RPM_KNOWLEDGE.yaml 中的明确登记及项目内来源。调用已安装 RPM 的 `project_claims` 验证。 |
| 研究关系 | RPM_KNOWLEDGE.yaml 的 `relations`。方向遵循 `source → target`。仅返回端点与有效来源均成立的记录。 |
| 变更记录 | CHANGE_LOG.md。原文放入 `change_log_markdown`，已解析的带时区条目放入 `changes`，`rpm_token` 按实际内容可为空。 |

Obsidian 项目页、知识笔记、来源笔记、Bases 和 Canvas 由 RPM 生成。接口从上述权威记录构建结果，正式联调另行核验生成笔记中的 `rpm_id`。生成页可能残留历史链接，客户端以当前权威快照为准。

## 2. 调用方式

依赖为本机 Python 3.12、PyYAML 及当前已部署的 RPM Skill。包内 Python 脚本只读运行，结果经 stdout 输出 UTF‑8 JSON。

```powershell
python -X utf8 -B ./rpm_knowledge_api.py snapshot
python -X utf8 -B ./rpm_knowledge_api.py snapshot --project-id <RPM项目ID>
python -X utf8 -B ./rpm_knowledge_api.py snapshot --project-id <RPM项目ID> --if-revision <上次修订号>
python -X utf8 -B ./rpm_knowledge_api.py resolve-file --project-id <RPM项目ID> --file-id <文件或来源ID>
python -X utf8 -B ./rpm_knowledge_api.py --settings <隔离设置JSON> snapshot
```

也可在工作台主进程中调用包内客户端。客户端以参数数组复用阶段三 `desktop/rpm-adapter.js` 的 `context` 只读传输通道、超时和大小限制，关闭 8 秒查询缓存。本次联调用的是实际工作树中的 adapter，正式路由和业务代码尚未接入。

```js
const { createKnowledgeReader } = require('./rpm-integration/workbench-rpm-knowledge.cjs');
const rpmAdapter = require('./desktop/rpm-adapter');
const reader = createKnowledgeReader(rpmAdapter, trustedRpmConfig);

const current = await reader.snapshot({ projectId: rpmProjectId });
const next = await reader.snapshot({ projectId: rpmProjectId, ifRevision: current.revision });
const source = await reader.resolveFile(rpmProjectId, sourceId);
```

`trustedRpmConfig` 在主进程生成，可由现有 `configFrom` 提供。CLI 的 `--skill-root` 与 `--settings` 供受信任的本地调用方配置。客户端不暴露任意命令、任意脚本或任意项目根参数。工作台 ID 与 RPM ID 分开，绑定及真实根继续交给阶段三逻辑。TPMS 的现有绑定是 `pjzlgv7wx4ks` 对应 `d72165400fae48eb9466e8151cdd15e3`，真实根为 `G:\TPMS`。

## 3. JSON 字段

机器可读定义见 `schema/rpm-knowledge-v1.schema.json`，含完整快照、未变化响应、文件解析和异常响应。

| 对象 | 主要字段和类型 |
| --- | --- |
| 快照 | `schema_version: 1`、`revision: string`、`generated_at: date-time`、`data_updated_at: date-time|null`、`scope: string|null`、`registry_complete: boolean`、`not_modified: boolean` |
| `projects[]` | `id,title,root,types,direction,status,stage,description,status_note`，另有 `tasks[]`、`changes[]`、`change_log_markdown`、`files: ID[]`、`deliverables: ID[]`、`file_summary`。登记的论文、专利或成果仍以其实际状态展示。 |
| `nodes[]` | `id,title,type,project_id,project_ids,description,status,source_files[]`。知识节点另有 `claims[]`，共享项按各项目保留摘要、状态和来源。 |
| `claims[]` | `project_id,local_id,description,status,status_origin,usage_context,method_usage,source_files[]`。共享节点的全局顶层摘要为 `null`，不同状态各自保留在 claim。 |
| `edges[]` | `id,source,target,relation_type,origin,evidence,evidence_items[],evidence_sources[],project_id,project_ids[]`。source、target 直接引用 `nodes[].id`。 |
| `files[]` | RPM CSV 字段加 `id,project_id,openable,absolute_path,href,related_file_ids[]`。原 CSV 的 `related_files` 以 `index_related_files` 保留供诊断。活动关系以 edges 与 `related_file_ids` 为准。文件大小和纳秒时间原样保留为字符串。 |
| `source_files[]` / `evidence_sources[]` | `id,file_id,rpm_source_id,title,project_id,path,relative_path,href,status,evidence,origin`。管理记录未入索引时 `file_id` 为 `null`。 |
| `issues[]` | `code,item,message`，并携带有问题的 `project_id` 或 `project_ids[]`。 |

### 节点和关系类型

- 知识节点沿用当前安装 RPM 类型。除项目和来源外，包含方向、研究问题、理论模型、方法、设计、文献、工程模型、数据集、实验、决策、结论、论文、专利、成果。现版 RPM 没有独立的仿真或分析枚举，相关资料沿用已登记类型与内容。
- `origin=research_relation` 保留项目登记的关系名称、方向、依据文字和对应原件引用。关系名称不是关键词匹配结果。
- `origin=file_relation` 保留 RPM 的 `derived_from`、`uses`、`validates`、`supports`、`related_to`、`supersedes`。依据文件指向其登记原件 `.rpm/relations.json`。这个来源只证明登记与依据文字存在，端点文件不会自动标为研究证据。
- `project_membership`、`index_membership`、`knowledge_citation` 分别是项目归属、索引归属和知识引证。界面可默认折叠这些边。对原文未指定相反方向的文件关系，保留输入端点顺序。
- 方法与项目绑定。跨项目共享只使用实际声明的 `share_key` 并核对类型和名称。冲突时保持项目独立并输出诊断。相同文字、文件名或项目类型不会产生共享关联。

### 状态口径

- 知识状态沿用 `declared, planned, historical, documented, verified`。状态来自项目配置、明确登记或 RPM 的默认值，`status_origin` 标识出处。
- `usage_context` 只说明记录属于登记方法、历史资料、文献或计划。尤其是 `documented` 或 `registered_method` 都不能单独证明方案已采用。
- 接口支持既有节点的可选显式注记 `method_usage`。值为 `adopted` 已确认采用、`investigating` 研究中、`historical_candidate` 历史候选、`literature_only` 文献中的方法、`undecided` 尚未确定。它是只读接口兼容扩展，正式数据没有补填这一字段。注记须有显式 `status`、相容类型和通过 RPM 核对的项目来源，否则返回 `null`。程序检查声明结构与出处，科研语义仍由登记者审阅。
- `adopted` 适用于已记录或已验证的方法。 `investigating` 适用于已记录或已验证的方法、设计和模型。 `historical_candidate` 适用于历史设计和模型。 `literature_only` 适用于文献。 `undecided` 适用于已声明、计划中或已记录的设计和模型。既有正式 TPMS 中没有方法节点，历史规划的候选方案不被升级为采用状态。
- 文件状态只使用 RPM 原记录。未确认状态为 `null`，`openable` 同时检查索引状态与当前磁盘路径。缺失原件的索引行可供诊断，图中省略失效来源及依赖它的有效关系。

## 4. 稳定 ID、原件打开和刷新

**ID**。项目节点使用 `project_id`，索引原件节点使用原始 `file_id`。知识节点沿用已安装 RPM 的 `identity('knowledge', project_id, local_id)` 或显式共享键 `identity('shared', share_key)`，与对应 Obsidian 知识笔记一致。已入索引的来源同时保留原 `file_id` 和 Obsidian 来源映射 `rpm_source_id`。未入索引的管理记录以既有来源算法生成投影 ID，实际 `file_id` 留空。任务以 `(project_id, task.id)` 标识。边沿用原型确定性规则 `identity('snapshot-edge', project_id, source, target, relation_type)`，这是对 RPM 未存独立边 ID 的投影。改标题、证据文字或任务状态会保持原 ID。更换内部键、共享键、关系端点或关系类型属于身份变化。共享声明冲突导致回退为私有 ID，客户端按快照处理。

**原件打开**。以 `project_id + source.id` 调 `resolveFile`，成功后主进程可交给现有本地文件打开能力。每次解析复核登记和当前文件，不接收由渲染层传入的任意路径。 `href` 是正确编码的本地 URI，`path` 用于系统打开和展示。验收验证了路径、URI 与原件存在性，正式 Electron 的系统打开动作仍待路由接入。索引文件权限、原件在解析后再次变化或操作系统缺少关联程序仍可能影响实际打开。

**刷新**。每次查询读取权威数据。 `generated_at` 表示查询时刻，`data_updated_at` 是本次跟踪的 RPM 配置和管理文件中最新的修改时间，二者都不是研究结论的时间戳。修订号基于归一化内容与查询范围。旧修订号相同仅返回头部与 `not_modified: true`。新修订号应原子替换对应范围的活动图，才能清除已撤回边。读取前后管理文件签名变化会重试，连续变化报 `unstable_inputs`。建议在 RPM 写操作结束后刷新。此机制不提供跨文件事务或实时推送。

**错误与部分结果**。查询错误以退出码 2 和 `{ok:false, schema_version:1, code, error}` 表示。常见代码含 `invalid_request`、`settings_invalid`、`registry_invalid`、`rpm_skill_missing`、`project_not_found`、`project_unavailable`、`file_not_found`、`file_unavailable`、`unstable_inputs`。出现 `registry_complete:false` 表示部分注册项目不可读。界面应标记对应图数据过期，避免把不可读项目或共享关系误当作已删除。 `issues` 中报告的无依据记录、失效来源和跨项目文件边不进入有效关系集。

## 5. 实测范围与接入限制

- 正式只读联调读取 1 个 TPMS 项目、8 个研究知识节点、5 条有据研究关系、13 条索引文件、8 条文件关系、5 项任务和 21 条变更。图中还包含索引、来源和归属投影，共 29 个节点及 51 条边，诊断为 0。
- 现有阶段三查询与新接口的 13 个文件 ID、8 条文件关系一致。通过实际阶段三传输验证全局快照、按项目快照、同修订号查询和文件定位。
- 正式 Vault 的主页、8 篇知识笔记和 8 篇来源笔记已逐项核对 ID。研究和文件关系使用的 5 个独立证据来源均解析到实际原件。
- 隔离测试涵盖多项目、同名且独立的方法、显式共享、任务和文件更新、关系变更与删除、失效来源、ID、空项目及异常输入。测试从样本生成器复建，正式示例快照无需嵌入 HTML。
- 正式项目及受核对的 Vault 内容、已安装 Skill、工作台源码在联调前后的文件哈希一致。正式路由、渲染器、Electron 打开动作及便携包发布留给工作台接入阶段。本包未做超大生产图基准。

### 复验命令

在解压后的目录执行。两个参数路径可以换成当前安装位置。

```powershell
python -X utf8 -B tests/fixture.py --api rpm_knowledge_api.py --output-dir . --phase missing
python -X utf8 -B tests/test_interface.py --api rpm_knowledge_api.py --temp-parent . --schema schema/rpm-knowledge-v1.schema.json
node tests/test_stage3_transport.cjs 'F:/ai/workhbuddy/workspace/research-workspace-main/desktop/rpm-adapter.js' 'F:/ai/codex/skills/research-project-manager' .
```

测试数据由程序新建独立 Vault 及三个合成项目，并导出基线、更新、失效三版快照。接口与 Schema 校验共 11 项通过。还通过了实际阶段三适配器同进程的无缓存刷新、关系去除及证据定位验证，以及现有阶段三适配器与材料查询的 9 项回归。合成原件路径按生成目录计算。
