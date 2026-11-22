"""Verify the read-only knowledge API against temporary projects created by installed RPM."""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import url2pathname

from fixture import (
    ADDED_RELATION, DATA_A, DEFAULT_SKILL, DESCRIPTOR, EXTRA_A, Fixture,
    HISTORICAL_TITLE, LAYOUT_TITLE, LAYOUT_TITLE_UPDATED, LITERATURE_TITLE, PENDING_TITLE,
    MGMT, MISSING_RELATION, MUTABLE_EVIDENCE, MUTABLE_RELATION, MUTATED_EVIDENCE,
    NO_EVIDENCE_RELATION, PRIVATE_TITLE, REPLACED_RELATION, SHARED_TITLE,
    SOURCE_A, SOURCE_B, STAGE_A, STAGE_A_UPDATED, default_api,
)


def fingerprint(root):
    """Read names, modification times and bytes; never take a writable RPM lock."""
    return {
        p.relative_to(root).as_posix(): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
        for p in root.rglob('*') if p.is_file()
    }


def parse_time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def scope_id(row):
    return row.get('id') or row.get('file_id')


def locate_edge(snapshot, label):
    matches = [edge for edge in snapshot['edges'] if edge['relation_type'] == label]
    assert len(matches) == 1, (label, matches)
    return matches[0]


def file_by_id(snapshot, identifier):
    return next(file for file in snapshot['files'] if scope_id(file) == identifier)


def project_by_id(snapshot, identifier):
    return next(project for project in snapshot['projects'] if project['id'] == identifier)


def encoded_path(value):
    uri = urlsplit(value)
    assert uri.scheme == 'file' and not uri.netloc and not uri.fragment, value
    return Path(url2pathname(uri.path))


def checked_snapshot(fixture, *args):
    before = fingerprint(fixture.root)
    snapshot = fixture.call('snapshot', *args)
    assert fingerprint(fixture.root) == before, '只读查询改写了隔离项目或 Vault'
    assert isinstance(snapshot['schema_version'], int) and snapshot['schema_version'] > 0
    assert isinstance(snapshot['revision'], str) and snapshot['revision']
    assert parse_time(snapshot['generated_at']).tzinfo is not None
    if snapshot.get('data_updated_at') is not None:
        assert parse_time(snapshot['data_updated_at']).tzinfo is not None
    if snapshot.get('not_modified'):
        return snapshot
    for key in ('projects', 'files', 'nodes', 'edges', 'issues'):
        assert isinstance(snapshot[key], list), key
    unique = {node['id'] for node in snapshot['nodes']}
    assert len(unique) == len(snapshot['nodes'])
    assert len({edge['id'] for edge in snapshot['edges']}) == len(snapshot['edges'])
    assert len({scope_id(file) for file in snapshot['files']}) == len(snapshot['files'])
    for node in snapshot['nodes']:
        assert all(field in node for field in ('title', 'type', 'project_id', 'description', 'status', 'source_files')), node
        for upstream in node['source_files']:
            assert scope_id(upstream) in unique, upstream
    for edge in snapshot['edges']:
        assert {edge['source'], edge['target']} <= unique and edge['source'] != edge['target'], edge
        assert edge['relation_type'] and edge['evidence'], edge
        for source in edge.get('evidence_sources', []):
            assert scope_id(source) in unique, source
    return snapshot


def resolve(fixture, project_id, file_id, *, expect=0):
    before = fingerprint(fixture.root)
    value = fixture.call('resolve-file', '--project-id', project_id, '--file-id', file_id, expect=expect)
    assert fingerprint(fixture.root) == before, '证据路径解析改写了隔离数据'
    return value


def output_file(value):
    if 'file' in value:
        return value['file']
    return value


def verify_before(fixture, before, report):
    ids = fixture.ids
    file_ids = fixture.file_ids('a')
    b_file_id = fixture.file_ids('b')[SOURCE_B]
    assert {project['id'] for project in before['projects']} == set(ids.values()), before['projects']
    empty = project_by_id(before, ids['empty'])
    assert empty['tasks'] == [] and not [x for x in before['files'] if x['project_id'] == ids['empty']]
    assert empty['stage'] is None and empty['status'] is None and empty['changes'] == [], empty
    assert not [n for n in before['nodes'] if n['project_id'] == ids['empty'] and n['type'] == 'method']
    report('多项目和空项目：读取三个正式形态的隔离项目，空任务和空索引不伪造')

    a = project_by_id(before, ids['a'])
    assert a['stage'] == STAGE_A and a['status'] == '进行中', a
    assert [(task['id'], task['status']) for task in a['tasks']] == [('T-01', 'todo')], a
    assert a['changes'], a
    b = project_by_id(before, ids['b'])
    assert b['tasks'][0]['id'] == 'CAL-01' and b['tasks'][0]['depends_on'] == [], b
    assert file_by_id(before, file_ids[DATA_A])['status'] == 'Original'
    assert {scope_id(file) for file in before['files']} == {*file_ids.values(), b_file_id}
    assert {file_id for file_id in file_ids.values()} <= {node['id'] for node in before['nodes']}
    report('任务、阶段、变更记录和索引：保留原始任务 ID 与文件 ID')

    private = [node for node in before['nodes'] if node['title'] == PRIVATE_TITLE]
    assert {node['project_id'] for node in private} == {ids['a'], ids['b']}, private
    assert len({node['id'] for node in private}) == 2
    shared = [node for node in before['nodes'] if node['title'] == SHARED_TITLE]
    assert len(shared) == 1 and set(shared[0]['project_ids']) == {ids['a'], ids['b']}, shared
    report('方法隔离：同名有据方法各自保留，显式共享声明才形成共享节点')

    def method_usage(node_title, project_id):
        candidates = [
            claim['method_usage'] for node in before['nodes'] if node['title'] == node_title
            for claim in node['claims'] if claim['project_id'] == project_id
        ]
        assert len(candidates) == 1, (node_title, project_id, candidates)
        return candidates[0]

    assert method_usage(SHARED_TITLE, ids['a']) == 'adopted'
    assert method_usage(SHARED_TITLE, ids['b']) is None
    assert method_usage(PRIVATE_TITLE, ids['a']) == 'investigating'
    assert method_usage(HISTORICAL_TITLE, ids['a']) == 'historical_candidate'
    assert method_usage(LITERATURE_TITLE, ids['b']) == 'literature_only'
    assert method_usage(PENDING_TITLE, ids['a']) == 'undecided'
    report('方法用法：五类明示口径按项目独立读取，缺失口径为 null')

    edge = locate_edge(before, MUTABLE_RELATION)
    cited = edge['evidence_sources']
    assert MUTABLE_EVIDENCE in edge['evidence'] and len(cited) == 1, edge
    assert scope_id(cited[0]) == file_ids[SOURCE_A], edge
    assert cited[0]['file_id'] == file_ids[SOURCE_A] and cited[0]['rpm_source_id'] != file_ids[SOURCE_A]
    registry_source, = locate_edge(before, 'supports')['evidence_sources']
    assert registry_source['file_id'] is None and registry_source['relative_path'].endswith('/.rpm/relations.json')
    record = output_file(resolve(fixture, ids['a'], registry_source['id']))
    assert record['file_id'] is None and record['id'] == registry_source['id'], record
    body = output_file(resolve(fixture, ids['a'], file_ids[SOURCE_A]))
    path = body.get('path') or body.get('absolute_path')
    assert Path(path).resolve(strict=True) == fixture.file('a', SOURCE_A), body
    href = body.get('href') or body.get('uri')
    assert '%23' in href and encoded_path(href).resolve(strict=True) == fixture.file('a', SOURCE_A), href
    resolve(fixture, ids['b'], file_ids[SOURCE_A], expect=2)
    wrong = resolve(fixture, ids['a'], '0' * 32, expect=2)
    assert wrong['code']
    report('证据追溯：边可定位准确文件 ID，Unicode、空格和井号路径往返成功，拒绝跨项目 ID')

    unchanged = checked_snapshot(fixture, '--if-revision', before['revision'])
    assert unchanged.get('not_modified') is True and unchanged['revision'] == before['revision'], unchanged
    single = checked_snapshot(fixture, '--project-id', ids['a'])
    assert {p['id'] for p in single['projects']} == {ids['a']}, single['projects']
    assert {n['id'] for n in single['nodes'] if n['title'] == SHARED_TITLE} == {shared[0]['id']}, single
    report('重复读取和条件刷新：相同数据 revision 一致，单项目与全局共享节点 ID 一致')


def verify_fast_refresh(fixture, before, report):
    def conditional():
        return fixture.call('context', '--knowledge-network', '--if-revision', before['revision'],
                            '--if-input-stamp', before['input_stamp'])

    repeat = conditional()
    assert repeat['not_modified'] and repeat['timing_ms']['fast_path']
    path = fixture.file('a', DATA_A)
    bytes_before = path.read_bytes()
    path.unlink()
    try:
        missing = conditional()
        assert not missing['not_modified'] and not missing['timing_ms']['fast_path']
        assert not file_by_id(missing, fixture.file_ids('a')[DATA_A])['openable']
    finally:
        path.write_bytes(bytes_before)
    assert conditional()['not_modified']
    report('快速修订校验：无变化走快路径，未改索引的原件删除会使缓存失效')


def verify_update(fixture, before, updated, report):
    assert updated['revision'] != before['revision'], updated
    assert updated['data_updated_at'] and before['data_updated_at']
    assert parse_time(updated['data_updated_at']) >= parse_time(before['data_updated_at'])
    old = project_by_id(before, fixture.ids['a'])
    new = project_by_id(updated, fixture.ids['a'])
    assert new['stage'] == STAGE_A_UPDATED and new['tasks'][0]['status'] == 'done'
    assert old['tasks'][0]['id'] == new['tasks'][0]['id']
    assert len(new['changes']) >= len(old['changes']), (old, new)
    ids = fixture.file_ids('a')
    assert file_by_id(updated, ids[SOURCE_A])['status'] == 'Validated'
    assert file_by_id(updated, ids[EXTRA_A])['relative_path'] == EXTRA_A
    assert {n['id'] for n in before['nodes']} <= {n['id'] for n in updated['nodes']}, (before, updated)
    names_before = {n['title']: n['id'] for n in before['nodes']}
    names_updated = {n['title']: n['id'] for n in updated['nodes']}
    assert names_before[LAYOUT_TITLE] == names_updated[LAYOUT_TITLE_UPDATED]
    assert locate_edge(before, MUTABLE_RELATION)['id'] == locate_edge(updated, MUTABLE_RELATION)['id']
    assert MUTATED_EVIDENCE in locate_edge(updated, MUTABLE_RELATION)['evidence']
    assert locate_edge(before, 'supports')['id'] == locate_edge(updated, 'supports')['id']
    assert locate_edge(before, 'supports')['evidence'] != locate_edge(updated, 'supports')['evidence']
    assert locate_edge(updated, ADDED_RELATION)
    labels = {edge['relation_type'] for edge in updated['edges']}
    assert REPLACED_RELATION not in labels and NO_EVIDENCE_RELATION not in labels, labels
    assert '候选相机算法' not in {item['title'] for item in updated['nodes']}
    assert updated['issues'], updated
    report('实际更新：新增节点、关系和文件，更新阶段与任务，删除旧关系，保留不变 ID')
    report('证据拦截：空证据边和计划性方法不进入有效图')


def verify_faults(fixture, updated, report):
    ids = fixture.file_ids('a')
    fixture.remove_physical_file()
    current = checked_snapshot(fixture)
    assert current['revision'] != updated['revision'], current
    assert MISSING_RELATION not in {edge['relation_type'] for edge in current['edges']}
    stale = file_by_id(current, ids[DATA_A])
    assert stale['openable'] is False and not stale['href'] and stale['related_file_ids'] == [], stale
    assert ids[DATA_A] not in {node['id'] for node in current['nodes']}
    assert not [e for e in current['edges'] if e['relation_type'] == 'supports' and ids[DATA_A] in (e['source'], e['target'])]
    resolve(fixture, fixture.ids['a'], ids[DATA_A], expect=2)
    report('物理文件失效：快照移除相关有效关系，旧索引 ID 无法打开')

    fixture.write('a', f'{MGMT}/{DESCRIPTOR}', 'version: 1\nnodes: [\n')
    current = checked_snapshot(fixture)
    assert current['issues'], current
    assert ADDED_RELATION not in {edge['relation_type'] for edge in current['edges']}
    assert any(p['id'] == fixture.ids['b'] for p in current['projects'])
    assert any(n['project_id'] == fixture.ids['b'] and n['type'] == 'method' for n in current['nodes'])
    malformed = fixture.guard(fixture.root / 'malformed-settings.json')
    malformed.write_text('{"vault":', encoding='utf-8')
    fixture.call('snapshot', expect=2, settings=malformed)
    fixture.call('snapshot', '--project-id', '0' * 32, expect=2)
    report('异常处理：错误项目、配置语法错误有明确错误，局部描述损坏不带入旧关系')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-root', type=Path, default=DEFAULT_SKILL)
    parser.add_argument('--api', type=Path, default=default_api())
    parser.add_argument('--schema', type=Path, help='用 JSON Schema 2020-12 校验每次响应，需本机安装 jsonschema')
    parser.add_argument('--temp-parent', type=Path, default=None,
                        help='可选隔离父目录，默认使用系统临时目录')
    args = parser.parse_args()
    if not args.api.is_file():
        parser.error(f'接口脚本不存在：{args.api}')
    parent = args.temp_parent.resolve(strict=True) if args.temp_parent else None
    results = []
    validator = None
    if args.schema:
        from jsonschema import Draft202012Validator, FormatChecker
        schema = json.loads(args.schema.read_text(encoding='utf-8-sig'))
        Draft202012Validator.check_schema(schema)
        validator = Draft202012Validator(schema, format_checker=FormatChecker())

    def report(name):
        results.append(name)
        print(f'PASS {name}', flush=True)

    with tempfile.TemporaryDirectory(prefix='rpm-interface-', dir=parent) as directory:
        fixture = Fixture(directory, args.skill_root, args.api)
        fixture.validator = validator
        fixture.seed()
        base = checked_snapshot(fixture)
        verify_before(fixture, base, report)
        verify_fast_refresh(fixture, base, report)
        fixture.update()
        updated = checked_snapshot(fixture, '--if-revision', base['revision'])
        assert updated.get('not_modified') is not True
        verify_update(fixture, base, updated, report)
        verify_faults(fixture, updated, report)
    if validator is not None:
        report('JSON Schema 2020-12：完整、条件刷新、文件解析和错误响应通过校验')
    print(f'{len(results)}/{len(results)} isolation interface checks passed', flush=True)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    main()
