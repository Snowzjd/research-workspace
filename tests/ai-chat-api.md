# POST /api/ai/chat

本机探测接口。它调用主进程 `ai.chat`（界面 `ai:chat` 的同一条实现），再把工具交给渲染层 `__RW_API__`（和界面、`/api/tools` 同一套工具）。单次最多 **6** 轮模型调用、**12** 次工具调用。

只监听 `127.0.0.1`。没有令牌返回 401。只读令牌返回 403。必须用「设置 → 外部 Agent 接入」里的**完整权限**令牌。

## 调用

```bash
curl -s -X POST "http://127.0.0.1:7317/api/ai/chat" \
  -H "Authorization: Bearer $RW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"<项目ID>\",\"message\":\"让综述 agent 基于知识库写 TPMS 换热器综述，先给文献清单和分类框架，先不要成文\"}"
```

端口以软件里显示的为准。令牌不要写进仓库。

请求字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `projectId` | 是 | 项目 ID、项目名或显示名 |
| `message` | 是 | 用户这句话 |
| `agentName` | 否 | 指定 Agent 显示名，找不到则 400 |
| `presetKey` | 否 | 如 `writing-review`。给了就优先于 `agentName` 和文中点名 |
| `autoApprove` | 否 | 只有布尔 `true` 才执行写操作。默认不写。`search_knowledge` 等只读工具总会执行 |

响应里看 `agent`、`switched`、`messages`、`toolCalls`、`finalText`。`stopped` 为 `needs_confirm` / `needs_approval` / `cap` 时表示循环提前停了。

## 风险

- 每次请求都会用本机已配置的模型 API Key 打真实补全，一轮最多 6 次。
- `autoApprove: true` 时，创建任务、改项目、保存文档会立刻落盘，和界面里打开「自动执行工具」一样。
- `delete_task` / `delete_todo` / `delete_project` **即使 autoApprove 也不会执行**，除非这次工具参数里的 `confirm` 严格等于布尔 `true`。字符串 `"true"` 不算。循环不会把「未确认」再喂回模型让它自己补上 `confirm`。
- `dry_run: true`（以及 `"true"` / `1`）仍然只预览，不删除、不写入。
- 探测**不会**把这句话追加进界面上的聊天记录。工具执行期间会暂时切到目标项目和点名的 Agent，请求结束再改回去。
- 不要把端口暴露到本机以外。

## 探针 B

上面的那句话应切到 `科研写作·综述`（`presetKey` 为 `writing-review`，`switched: true`）。综述人设要求先 `search_knowledge` 且 `mode=search`，中文、英文各查一次，然后给文献清单和分类框架，用户没确认前不成文。若模型没显式传 `mode`，写作身份或文献类 query 也会默认 `search`；短问答仍默认 `ask`。
