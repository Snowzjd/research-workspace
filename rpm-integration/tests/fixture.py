"""Build reproducible, synthetic RPM projects in a newly created isolated directory."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

import yaml

DEFAULT_SKILL = Path('F:/ai/codex/skills/research-project-manager')
MGMT = '00_Project_Management'
DESCRIPTOR = 'RPM_KNOWLEDGE.yaml'
SOURCE_A = '01_Planning/潮位方案 #1.md'
DATA_A = '05_Data/潮位观测样本.csv'
SOURCE_B = '01_Planning/相机校准记录.md'
EXTRA_A = '06_Experiments_and_Execution/低潮异常样本复核.md'
STAGE_A = '两站布设与首轮记录'
STAGE_B = '校准范围核对'
STAGE_A_UPDATED = '首轮样本复核'
REPLACED_RELATION = '规定采样间隔'
MISSING_RELATION = '补证后核对'
ADDED_RELATION = '复核异常读数'
MUTABLE_RELATION = '提供实地点位'
MUTABLE_EVIDENCE = '方案已经确认潮沟与湿地内缘两处点位。'
MUTATED_EVIDENCE = '更新的方案记录保留潮沟点位并复核湿地内缘参照点。'
NO_EVIDENCE_RELATION = '无依据的跨项目关系'
SHARED_TITLE = '测量不确定度评估'
LAYOUT_TITLE = '两站同步布设方案'
LAYOUT_TITLE_UPDATED = '两站同步布设方案（复核后）'
PENDING_TITLE = '增设比对测站的待定方案'
HISTORICAL_TITLE = '旧版单站样带候选'
LITERATURE_TITLE = '文献中的图像亚像素定位'
PRIVATE_TITLE = '分段重复性判定'
MARKER = '.rpm-interface-isolated'


def default_api():
    here = Path(__file__).resolve()
    candidates = (
        here.parent.parent / 'rpm_knowledge_api.py',
        here.parent.parent / 'package' / 'rpm_knowledge_api.py',
    )
    return next((path for path in candidates if path.is_file()), candidates[0])


def dump_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def invoke(entrypoint, flags):
    return subprocess.run(
        [sys.executable, '-X', 'utf8', '-B', str(entrypoint), *map(str, flags)],
        capture_output=True, text=True, encoding='utf-8', timeout=40,
    )


def json_response(result, label):
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise AssertionError(f'{label} 未返回 JSON，退出码 {result.returncode}\n{result.stdout}\n{result.stderr}') from error
    assert isinstance(value, dict), (label, value)
    return value


class Fixture:
    def __init__(self, target, skill, api):
        self.root = Path(target).resolve(strict=True)
        self.skill = Path(skill).resolve(strict=True)
        self.api = Path(api).resolve() if api is not None else None
        self.validator = None
        marker = self.root / MARKER
        if not self.root.name.startswith('rpm-interface-') or any(self.root.iterdir()):
            raise ValueError(f'只允许使用全新的临时隔离目录：{self.root}')
        marker.write_text('RPM knowledge interface fixture\n', encoding='utf-8')
        self.vault = self.root / 'Vault 隔离'
        self.settings = self.root / 'rpm-settings.json'
        self.projects = {
            'a': self.root / 'A 河口观测 #1',
            'b': self.root / 'B 相机校准',
            'empty': self.root / 'C 新建空项目',
        }
        self.ids = {}

    def guard(self, path):
        path = Path(path).resolve()
        if not (self.root / MARKER).is_file() or not path.is_relative_to(self.root):
            raise ValueError(f'目标超出隔离范围：{path}')
        return path

    def file(self, project_key, relative):
        return self.guard(self.projects[project_key] / relative)

    def write(self, project_key, relative, content):
        location = self.file(project_key, relative)
        location.parent.mkdir(parents=True, exist_ok=True)
        location.write_text(content, encoding='utf-8')
        return location

    def rpm(self, *argv):
        self.guard(self.settings)
        result = invoke(self.skill / 'scripts' / 'rpm.py', ['--settings', self.settings, *argv])
        if result.returncode:
            raise AssertionError(f'隔离 RPM {argv!r} 失败：{result.stdout}\n{result.stderr}')
        return json_response(result, 'RPM')

    def call(self, *argv, expect=0, settings=None):
        if self.api is None:
            raise ValueError('没有指定接口脚本')
        result = invoke(self.api, ['--skill-root', self.skill, '--settings', self.guard(settings or self.settings), *argv])
        value = json_response(result, '工作台只读接口')
        assert result.returncode == expect, (argv, result.returncode, value, result.stderr)
        if expect == 0:
            assert value.get('ok') is True, (argv, value)
        else:
            assert value.get('ok') is False and value.get('code') and value.get('error'), (argv, value)
        if self.validator is not None:
            self.validator.validate(value)
        return value

    def file_ids(self, project_key):
        with self.file(project_key, f'{MGMT}/FILE_INDEX.csv').open(encoding='utf-8-sig', newline='') as stream:
            return {row['relative_path']: row['file_id'] for row in csv.DictReader(stream)}

    def descriptor(self, key, value=None):
        relative = f'{MGMT}/{DESCRIPTOR}'
        if value is None:
            return yaml.safe_load(self.file(key, relative).read_text(encoding='utf-8'))
        self.write(key, relative, yaml.safe_dump(value, sort_keys=False, allow_unicode=True))

    def seed(self):
        self.rpm('vault-init', self.guard(self.vault))
        for project_key, title, direction, stage in (
            ('a', '合成样本·河口观测', '两站潮位变化测量', STAGE_A),
            ('b', '合成样本·相机校准', '相机标尺重复读数', STAGE_B),
            ('empty', '合成样本·新建空项目', '建立项目登记', None),
        ):
            root = self.guard(self.projects[project_key])
            self.rpm('init', root, '--name', title, '--direction', direction, '--type', 'Research+Experiment')
            context = self.rpm('context', root)
            self.ids[project_key] = context['project']['project_id']
            if stage:
                self.rpm('update', root, '--project-status', '进行中', '--stage', stage)
        self.write('a', SOURCE_A, '# 两站观测方案\n\n采用潮沟与湿地内缘两站，间隔十分钟，复测时核对参照点。两组重复读数评估不确定度。早期曾考虑单站样带，现有两站；是否增设比对测站尚未确定。\n')
        self.write('a', DATA_A, 'time,point,level_mm\n08:10,channel,201\n08:20,inside,198\n')
        self.write('b', SOURCE_B, '# 相机校准记录\n\n使用棋盘格与固定标尺，在光照不变的条件下重复读数；以各重复组的离散度评估不确定度。随附文献笔记记录了亚像素定位方法，仅供查阅。\n')
        for key in ('a', 'b'):
            self.rpm('scan', self.projects[key])
        a_ids = self.file_ids('a')
        self.rpm('update', self.projects['a'], '--task-id', 'T-01', '--task-title', '核对十分钟采样记录',
                 '--task-status', 'todo')
        self.rpm('update', self.projects['a'], '--file-id', a_ids[DATA_A], '--file-status', 'Original',
                 '--evidence', '隔离夹具的合成观测数据原件。')
        self.rpm('update', self.projects['a'], '--source', a_ids[SOURCE_A], '--target', a_ids[DATA_A],
                 '--relation', 'supports', '--evidence', '方案明确约定了 CSV 的两站记录范围。')
        a_protocol = source(file_id=a_ids[SOURCE_A])
        a_data = source(file_id=a_ids[DATA_A])
        b_notes = source(path=SOURCE_B)
        self.descriptor('a', {
            'version': 1,
            'nodes': [
                node('question', 'research_question', '两站水位同步性问题',
                     '核对潮沟和湿地内缘的水位变化时序是否同步。', a_protocol, '方案给出两站和十分钟测量口径。'),
                node('layout', 'design', LAYOUT_TITLE,
                     '选择潮沟与湿地内缘两处点位，按共同参照点组建同步观测。', a_protocol, '方案已登记两处同步观测点。'),
                node('series', 'dataset', '两站合成水位时序',
                     '合成表包含潮沟及湿地内缘各自的观测时点与数值。', a_data, 'CSV 提供 time、point 与 level_mm 三列。'),
                node('uncertainty', 'method', SHARED_TITLE,
                     '使用合成潮位读数的两组复测序列记录数据的差异。', a_protocol,
                     '方案明确已经用两组水位复测评估不确定度。', share_key='synthetic-uncertainty', method_usage='adopted'),
                node('private-repeat', 'method', PRIVATE_TITLE,
                     '分别检查两处观测断面的重复观测组。', a_protocol, '方案明确规定两站的重复观测条件。',
                     method_usage='investigating'),
                node('pending-layout', 'design', PENDING_TITLE,
                     '后续是否增设供复核的比对测站仍由项目组确认。', a_protocol, '观测方案明确新增比对站待定。',
                     status='planned', method_usage='undecided'),
                node('old-layout', 'design', HISTORICAL_TITLE,
                     '归档的单站方案属于早期候选，当前分别保留两站。', a_protocol, '方案明确早期单站思路与现行两站的区别。',
                     status='historical', method_usage='historical_candidate'),
            ],
            'relations': [
                relation('layout', 'question', MUTABLE_RELATION, a_protocol, MUTABLE_EVIDENCE),
                relation('layout', 'series', REPLACED_RELATION, a_protocol, '方案规定两站都按十分钟间隔记录。'),
                relation('question', 'series', MISSING_RELATION, a_data, 'CSV 是问题的后续复核资料。'),
            ],
        })
        self.write('b', f'{MGMT}/TASKS.md',
                   '---\ntasks:\n  - id: CAL-01\n    title: 复核标尺读数\n    status: doing\n---\n\n# 任务\n')
        self.descriptor('b', {
            'version': 1,
            'nodes': [
                node('uncertainty', 'method', SHARED_TITLE,
                     '使用相机固定标尺的重复读数组评估重复性。', b_notes,
                     '校准记录明确交代相机重复组离散度的评估。', share_key='synthetic-uncertainty'),
                node('private-repeat', 'method', PRIVATE_TITLE,
                     '相机按固定光照条件逐组复核标尺读数。', b_notes, '校准记录登记固定光照与重复读数。'),
                node('reading', 'literature', LITERATURE_TITLE,
                     '随附文献笔记写有图像亚像素定位方法，留作文献比较。', b_notes,
                     '随附文献笔记区分了当前实验记录与文献中的候选位置提取方法。',
                     status='historical', method_usage='literature_only'),
            ],
            'relations': [],
        })
        dump_json(self.root / 'fixture-ids.json', {
            'project_ids': self.ids,
            'initial_file_ids_a': a_ids,
            'initial_file_ids_b': self.file_ids('b'),
        })

    def update(self):
        original = self.file_ids('a')
        draft = self.descriptor('a')
        # Perform real RPM updates before introducing intentionally broken knowledge records.
        self.write('a', EXTRA_A, '# 低潮异常样本复核\n\n低潮时段保留两个样本的原始记录，并核对第二笔读数的参照点变化。\n')
        self.rpm('scan', self.projects['a'])
        self.rpm('update', self.projects['a'], '--stage', STAGE_A_UPDATED,
                 '--task-id', 'T-01', '--task-title', '核对十分钟采样记录', '--task-status', 'done')
        self.rpm('update', self.projects['a'], '--file-id', original[SOURCE_A], '--file-status', 'Validated',
                 '--evidence', '合成夹具已核对观测方案记录。')
        # An existing declared file relation keeps its identity when its evidence changes.
        self.rpm('update', self.projects['a'], '--source', original[SOURCE_A], '--target', original[DATA_A],
                 '--relation', 'supports', '--evidence', '复核确认两个 CSV 样本均处于先前方案规定的范围。')
        new_ids = self.file_ids('a')
        for name, identifier in original.items():
            assert new_ids[name] == identifier, (name, original, new_ids)
        next(row for row in draft['nodes'] if row['id'] == 'layout')['title'] = LAYOUT_TITLE_UPDATED
        draft['nodes'] += [
            node('qc', 'conclusion', '两样本参照点复核',
                 '核对两笔合成记录，保留第二笔参照点检查结果。', source(file_id=new_ids[EXTRA_A]),
                 '复核记录列出两笔样本及参照点变化。', status='verified'),
            node('planned-method', 'method', '候选相机算法',
                 '这是尚未采用的计划性比较方案，保留为仅供审阅的测试。', source(path=SOURCE_A),
                 '观测方案提供可用于未来研究的测试背景。', status='planned', method_usage='adopted'),
        ]
        draft['relations'] = [
            relation('layout', 'question', MUTABLE_RELATION, source(path=SOURCE_A), MUTATED_EVIDENCE),
            relation('question', 'series', MISSING_RELATION, source(file_id=original[DATA_A]),
                     'CSV 是问题的后续复核资料。'),
            relation('qc', 'question', ADDED_RELATION, source(file_id=new_ids[EXTRA_A]),
                     '复核记录明确核验同一个研究问题相关的异常读数。'),
            dict(source='qc', target='direction', relation=NO_EVIDENCE_RELATION, sources=[]),
        ]
        self.descriptor('a', draft)

    def remove_physical_file(self):
        self.file('a', DATA_A).unlink()


def source(*, path=None, file_id=None):
    if (path is None) == (file_id is None):
        raise ValueError('需要 path、file_id 中的一项')
    return {'path': path} if path is not None else {'file_id': file_id}


def node(identifier, kind, title, description, reference, evidence, *, status='documented', share_key=None, method_usage=None):
    row = {
        'id': identifier, 'kind': kind, 'title': title, 'summary': description,
        'status': status, 'sources': [{**reference, 'evidence': evidence}],
    }
    if share_key is not None:
        row['share_key'] = share_key
    if method_usage is not None:
        row['method_usage'] = method_usage
    return row


def relation(start, end, label, reference, evidence):
    return {'source': start, 'target': end, 'relation': label, 'sources': [{**reference, 'evidence': evidence}]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-root', type=Path, default=DEFAULT_SKILL)
    parser.add_argument('--api', type=Path, default=default_api())
    parser.add_argument('--output-dir', type=Path, default=Path.cwd(),
                        help='在既有父目录下创建一个唯一的 rpm-interface-* 子目录')
    parser.add_argument('--phase', choices=('base', 'updated', 'missing'), default='updated')
    args = parser.parse_args()
    parent = args.output_dir.resolve(strict=True)
    # A new uniquely named directory is required, so existing files are never reused.
    root = Path(tempfile.mkdtemp(prefix='rpm-interface-', dir=parent))
    fixture = Fixture(root, args.skill_root, args.api)
    fixture.seed()
    dump_json(root / 'snapshot-base.json', fixture.call('snapshot'))
    if args.phase in {'updated', 'missing'}:
        fixture.update()
        dump_json(root / 'snapshot-updated.json', fixture.call('snapshot'))
    if args.phase == 'missing':
        fixture.remove_physical_file()
        dump_json(root / 'snapshot-missing.json', fixture.call('snapshot'))
    print(root, flush=True)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    main()
