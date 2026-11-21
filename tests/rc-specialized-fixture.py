"""Set up a test-only RPM project and a central Vault on separately selected volumes."""
from pathlib import Path
import json
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'rpm-integration' / 'tests'))
from fixture import Fixture, SOURCE_A, relation, source  # noqa: E402

room, vault, skill = map(Path, sys.argv[1:])
if not vault.name.startswith('rw-rc-vault-') or any(vault.iterdir()):
    raise ValueError('The central Vault must be a new empty fixture')
fixture = Fixture(room, skill, root / 'rpm-integration' / 'rpm_knowledge_api.py')
fixture.seed()
descriptor = fixture.descriptor('a')
descriptor['relations'].append(relation(
    'series', 'private-repeat', '提供重复组记录',
    source(file_id=fixture.file_ids('a')[SOURCE_A]),
    '测评观测方案明确以两处断面重复观测组检查记录。'
))
fixture.descriptor('a', descriptor)
frontmatter = '---\r\ntitle: "两相测量"\r\ntags:\r\n  - 校准\r\nmetadata:\r\n  window: 6\r\n---\r\n'
vault_note = '试验 记录 [复核] #1.md'
(vault / vault_note).write_bytes((
    '\ufeff' + frontmatter + '\r\n# 隔离中央笔记\r\n\r\n引用 [[校准基准|别名引用]]。\r\n'
).encode('utf-8'))
(vault / '校准基准.md').write_text('# 校准基准\n', encoding='utf-8')
print(json.dumps({
    'settings': str(fixture.settings),
    'projectRoot': str(fixture.projects['a']),
    'projectNote': SOURCE_A,
    'vaultNote': vault_note,
    'projectId': fixture.ids['a'],
    'yaml': frontmatter,
}, ensure_ascii=False))
