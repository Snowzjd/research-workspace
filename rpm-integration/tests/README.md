# RPM 只读接口隔离测试数据

此目录提供可以复建的独立测试夹具。全部输入是合成数据，运行时由已安装的 RPM 创建三个项目和单独 Vault。

- **合成样本·河口观测** 有带中文、空格与井号的 Markdown 原件、CSV、任务及两版研究关系。
- **合成样本·相机校准** 有独立来源、同名私有方法以及显式确认的共享节点。
- **合成样本·新建空项目** 有实际登记及方向，任务、状态、阶段和文件索引保持空态。

## 生成可供开发使用的快照与原件

从解压后的接口包根目录运行，或替换为实际 API 和 Skill 路径。目标父目录必须已存在，每次运行均在其下新建唯一隔离子目录。

```powershell
python -X utf8 -B tests/fixture.py --api rpm_knowledge_api.py --skill-root 'F:/ai/codex/skills/research-project-manager' --output-dir . --phase updated
```

输出目录包含隔离 Vault、项目原件、索引、`rpm-settings.json`、项目与文件 ID 清单，以及 `snapshot-base.json` 和 `snapshot-updated.json`。`--phase base` 保留基线状态。`--phase missing` 额外移除一个合成原件并生成 `snapshot-missing.json` 供失效场景验证。文件链接和根路径按本次目录实时计算。新运行会产生新的测试项目和文件 ID，同一次运行的前后快照保留已有 ID。

## 端到端校验

```powershell
python -X utf8 -B tests/test_interface.py --api rpm_knowledge_api.py --skill-root 'F:/ai/codex/skills/research-project-manager' --temp-parent .
```

测试结束后清理本次临时测试目录。测试核对接口调用前后的文件集合、绝对路径、字节哈希和修改时间。检查范围包括多项目与空态、任务和文件状态、方法隔离、证据路径、共享 ID、条件刷新、节点改名与 ID 稳定、关系删除、物理文件失效以及配置错误。

如已安装 Python `jsonschema`，可在同一命令末尾加 `--schema schema/rpm-knowledge-v1.schema.json`。这会按 JSON Schema 2020-12 校验完整快照、条件刷新结果、文件路径解析和错误响应。
