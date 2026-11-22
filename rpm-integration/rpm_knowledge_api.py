"""Workbench integration contract for the installed RPM 2.0 read-only parsers."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import hashlib
import json
import os
from stat import S_ISREG
from time import perf_counter
import re
import sys

SCHEMA = 1
DEFAULT_SKILL = Path(os.environ.get('CODEX_HOME') or (Path.home() / '.codex')) / 'skills' / 'research-project-manager'
RPM_ID = re.compile(r'[a-f0-9]{32}\Z')
LOG_ITEM = re.compile(r'^- (\d{4}-\d\d-\d\dT\S+) (.+?)(?: \[rpm:([^\]]+)\])?$', re.M)
RECORDS = (
    'PROJECT_CONFIG.yaml', 'PROJECT_README.md', 'PROJECT_STATUS.md', 'TASKS.md',
    'FILE_INDEX.csv', 'CHANGE_LOG.md', 'RPM_KNOWLEDGE.yaml', '.rpm/relations.json',
)
MODELS_OR_DESIGNS = {'design', 'theoretical_model', 'engineering_model'}
METHOD_USAGE = {
    'adopted': ({'method'}, {'documented', 'verified'}),
    'investigating': (MODELS_OR_DESIGNS | {'method'}, {'documented', 'verified'}),
    'historical_candidate': (MODELS_OR_DESIGNS, {'historical'}),
    'literature_only': ({'literature'}, {'declared', 'planned', 'historical', 'documented', 'verified'}),
    'undecided': (MODELS_OR_DESIGNS, {'declared', 'planned', 'documented'}),
}
sys.dont_write_bytecode = True


class QueryError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise QueryError('invalid_request', message)


def load_api(skill_root):
    scripts = skill_root / 'scripts'
    if not (scripts / 'rpm.py').is_file():
        raise QueryError('rpm_skill_missing', f'RPM Skill 入口不存在 {scripts / "rpm.py"}')
    sys.path.insert(0, str(scripts))
    try:
        import yaml
        import core
        import knowledge
        import project
        import vault
        from rpm import context
    except ImportError as error:
        raise QueryError('rpm_dependency_missing', str(error)) from error
    return core, knowledge, project, vault, context, yaml


def input_registry(api, settings, requested):
    core, _, _, vault, _, _ = api
    try:
        meta = core.json_load(settings, None)
    except (OSError, ValueError) as error:
        raise QueryError('settings_invalid', str(error)) from error
    if not isinstance(meta, dict) or not isinstance(meta.get('vault'), str) or not meta['vault']:
        raise QueryError('settings_invalid', '使用含绝对 Vault 路径的 RPM 配置')
    if not Path(meta['vault']).is_absolute():
        raise QueryError('settings_invalid', 'Vault 路径须为绝对路径')
    home = vault.vault_location(settings)
    if home is None or not home.is_dir():
        raise QueryError('vault_unavailable', 'RPM Vault 不可访问')
    register = core.inside(home, '.rpm/projects.json')
    if not register.is_file() and not core.inside(home, '.rpm/owner.json').is_file():
        raise QueryError('registry_invalid', '此 Vault 未初始化 RPM 登记目录')
    try:
        found = vault.registry(home)
    except (OSError, ValueError) as error:
        raise QueryError('registry_invalid', str(error)) from error
    if not isinstance(found, dict) or any(
        not RPM_ID.fullmatch(key) or not isinstance(root, str) or not Path(root).is_absolute()
        for key, root in found.items()
    ):
        raise QueryError('registry_invalid', 'RPM 登记必须是项目 ID 到绝对路径的映射')
    if requested and requested not in found:
        raise QueryError('project_not_found', f'RPM 项目未登记 {requested}')
    return home, register, found


def stamp(path):
    try:
        info = path.stat()
        return info.st_size, info.st_mtime_ns, info.st_ino, info.st_ctime_ns
    except FileNotFoundError:
        return None


def roots_and_stamps(api, home, settings, register, registered):
    core = api[0]
    tracked = {settings: stamp(settings), register: stamp(register)}
    roots, issues = {}, []
    for project_id, location in sorted(registered.items()):
        try:
            root = core.project_root(location)
            if core.overlaps(root, home):
                raise ValueError('项目与 Vault 的路径重叠')
            paths = [core.control_path(root, name) for name in RECORDS]
            tracked.update((path, stamp(path)) for path in paths)
            roots[project_id] = root
        except (OSError, ValueError) as error:
            issues.append(dict(code='project_unavailable', project_id=project_id, item='registry', message=str(error)))
    return roots, tracked, issues


def profile_changes(markdown):
    records = []
    for match in LOG_ITEM.finditer(markdown):
        timestamp, message, tag = match.groups()
        try:
            stamp_value = datetime.fromisoformat(timestamp)
        except ValueError:
            continue
        if stamp_value.tzinfo is None:
            continue
        records.append({'timestamp': timestamp, 'message': message, 'rpm_token': tag})
    return records


def claim_annotations(core, knowledge, yaml, root, project_id, accepted, issues):
    annotations = {}
    descriptor = core.control_path(root, knowledge.DESCRIPTORS)
    if not descriptor.is_file():
        return annotations
    try:
        raw = core.yaml_load(descriptor)
    except (OSError, ValueError, TypeError, yaml.YAMLError):
        return annotations  # The canonical validator reports malformed descriptors.
    if not isinstance(raw, dict) or not isinstance(raw.get('nodes'), list):
        return annotations
    grouped = defaultdict(list)
    for item in raw['nodes']:
        if isinstance(item, dict) and isinstance(item.get('id'), str):
            grouped[item['id']].append(item)
    for key, values in grouped.items():
        if key not in accepted or key == 'direction' or len(values) != 1:
            continue
        item, claim = values[0], accepted[key]
        usage = item.get('method_usage')
        explicit_status = 'status' in item
        if usage is not None:
            allowed = METHOD_USAGE.get(usage) if isinstance(usage, str) else None
            if not allowed or claim['kind'] not in allowed[0] or claim['status'] not in allowed[1] or not explicit_status:
                issues.append(dict(code='method_usage_invalid', project_id=project_id, item=key,
                                   message='方法语境需要明确状态，并与 RPM 节点类型及状态相容'))
                usage = None
        annotations[key] = {'method_usage': usage,
                            'status_origin': 'descriptor' if explicit_status else 'rpm_default'}
    return annotations


def project_entries(api, roots, issues):
    core, knowledge, project, _, context, yaml = api
    entries = {}
    for identifier, root in roots.items():
        try:
            config = core.config(root)
            if config.get('project_id') != identifier:
                raise ValueError('中央登记与项目配置 ID 不一致')
            if not isinstance(config.get('name'), str) or not config['name'].strip():
                raise ValueError('PROJECT_CONFIG 缺少有效项目名称')
            direction = config.get('direction')
            if direction is not None and not isinstance(direction, str):
                raise ValueError('研究方向字段须为文本')
            kinds = config.get('types', [])
            if not isinstance(kinds, list) or not all(isinstance(kind, str) for kind in kinds):
                raise ValueError('项目类型须为文本列表')
            ctx = context(root, config)
            rows = project.load_index(root)
            changes = core.read(core.control_path(root, 'CHANGE_LOG.md'))
            notes = core.read(core.control_path(root, 'PROJECT_README.md'))
            description = re.search(r'^## 项目介绍\s*\n(.*?)(?=^## |\Z)', notes, re.M | re.S)
            description = description.group(1).strip() if description and description.group(1).strip() else direction
            if not isinstance(ctx['relations'], list):
                raise ValueError('文件关系记录须为列表')
            if any(set(row) != set(project.FIELDS) or any(not isinstance(value, str) for value in row.values())
                   for row in rows):
                raise ValueError('文件索引存在缺失或额外列')
            file_ids = {row['file_id'] for row in rows}
            if any(not RPM_ID.fullmatch(fid) for fid in file_ids):
                raise ValueError('文件索引含无效 ID')
            diagnostics = []
            nodes, relations = knowledge.project_claims({'root': root, 'data': config}, diagnostics)
            issues.extend({'code': 'knowledge_record_invalid', 'project_id': identifier,
                           'item': row.get('item'), 'message': row['issue']} for row in diagnostics)
            annotations = claim_annotations(core, knowledge, yaml, root, identifier, nodes, issues)
            profile = {
                'id': identifier, 'title': config['name'], 'root': str(root), 'types': kinds,
                'direction': direction or None, 'status': ctx['state'].get('status') or None,
                'stage': ctx['state'].get('stage') or None, 'description': description or None,
                'status_note': ctx['status_note'], 'tasks': [
                    {'id': task['id'], 'title': task['title'], 'status': task['status'],
                     'depends_on': task.get('depends_on', [])} for task in ctx['tasks']
                ],
                'changes': profile_changes(changes), 'change_log_markdown': changes,
                'files': [], 'deliverables': [],
            }
            entries[identifier] = dict(root=root, profile=profile, rows=rows, nodes=nodes,
                                       relations=relations, annotations=annotations, file_relations=ctx['relations'])
        except (OSError, ValueError, TypeError, KeyError, AttributeError, yaml.YAMLError) as error:
            issues.append(dict(code='project_unavailable', project_id=identifier, item='project', message=str(error)))
    return entries


def sort_rows(rows):
    return sorted(rows.values(), key=lambda row: row['id'])


def lookup_shares(entries, issues):
    names = defaultdict(set)
    owners = defaultdict(set)
    for project_id, entry in entries.items():
        for node in entry['nodes'].values():
            key = node['share_key']
            if key:
                names[key].add((node['kind'], node['title'].casefold()))
                owners[key].add(project_id)
    invalid = {key for key, available in names.items() if len(available) != 1}
    for key in sorted(invalid):
        issues.append(dict(code='share_conflict', project_ids=sorted(owners[key]), item=key,
                           message='共享声明的类型或名称冲突，保持项目独立'))
    return invalid


def method_context(kind, status):
    if kind == 'method':
        return 'registered_method'
    if kind == 'literature':
        return 'literature_record'
    if status == 'historical':
        return 'historical_record'
    if status in {'declared', 'planned'} and kind != 'direction':
        return 'planned_or_declared'
    return None


class SnapshotPaths:
    """Reuse directory validation within one read. Opening an original still rechecks its live path."""
    def __init__(self, core):
        self.core = core
        self.parents = {}
        self.files = {}

    def file(self, root, relative):
        key = (root, relative)
        if key in self.files:
            return self.files[key]
        rel = Path(relative)
        if rel.anchor or not rel.parts or '..' in rel.parts:
            raise ValueError(f'项目相对路径无效 {relative}')
        name = rel.name
        if any(c in name for c in ':<>|?*"') or name.rstrip('. ') != name or Path(name).is_reserved():
            raise ValueError(f'路径包含保留名称 {relative}')
        parent_key = (root, rel.parent)
        if parent_key not in self.parents:
            self.parents[parent_key] = root if len(rel.parts) == 1 else self.core.inside(root, rel.parent)
        target = self.parents[parent_key] / name
        try:
            info = target.lstat()
        except FileNotFoundError:
            opened = False
        else:
            if self.core.reparse(info):
                raise ValueError(f'路径经过符号链接或重解析点 {target}')
            opened = S_ISREG(info.st_mode)
        self.files[key] = (target, opened)
        return self.files[key]


def inputs_signature(api, roots, tracked, paths):
    """A fast conditional-read guard for the complete graph, including original availability."""
    core, _, project, _, _, _ = api
    digest = hashlib.sha256()

    def record(value):
        digest.update(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
        digest.update(b'\0')

    record(['graph-inputs-v2', sorted((key, str(root)) for key, root in roots.items())])
    code_files = {Path(__file__), *(Path(module.__file__) for module in api[:4])}
    for filename in sorted(code_files, key=str):
        with filename.open('rb') as stream:
            record([str(filename), hashlib.file_digest(stream, 'sha256').hexdigest()])
    for pathname in sorted(tracked, key=str):
        record(str(pathname))
        if tracked[pathname] is not None:
            # Check the actual control contents so same-length metadata edits are observed.
            with pathname.open('rb') as stream:
                record(hashlib.file_digest(stream, 'sha256').hexdigest())
    for key, root in sorted(roots.items()):
        for name in sorted(core.CONTROL):
            control = core.control_path(root, name)
            record([name, control.is_file()])
        for row in project.load_index(root):
            relative = row['relative_path']
            _, exists = paths.file(root, relative)
            record([key, relative, exists])
    return digest.hexdigest()


def build_graph(api, entries, issues, paths=None):
    core, knowledge, project, *_ = api
    paths = paths or SnapshotPaths(core)
    nodes, files, edges = {}, {}, {}
    local = {}
    invalid_shares = lookup_shares(entries, issues)
    for entry in entries.values():
        profile = entry['profile']
        identifier = profile['id']
        if identifier in nodes:
            raise QueryError('identity_collision', f'重复项目 ID {identifier}')
        nodes[identifier] = {
            'id': identifier, 'type': 'project', 'title': profile['title'], 'project_id': identifier,
            'project_ids': [identifier], 'description': profile['description'], 'status': profile['status'],
            'source_files': [],
        }

    def add_edge(project_id, source, target, kind, evidence, origin, refs=()):
        if source == target:
            issues.append(dict(code='self_relation', project_id=project_id, item=source, message='省略解析后同端点的关系'))
            return
        identifier = knowledge.identity('snapshot-edge', project_id, source, target, kind)
        if identifier in edges and edges[identifier]['origin'] != origin:
            identifier = knowledge.identity('snapshot-edge', project_id, source, target, kind, origin)
        row = edges.setdefault(identifier, {
            'id': identifier, 'source': source, 'target': target, 'relation_type': kind,
            'evidence': '', 'evidence_items': [], 'evidence_sources': [],
            'project_id': project_id, 'project_ids': [project_id], 'origin': origin,
        })
        for explanation in evidence:
            if explanation not in row['evidence_items']:
                row['evidence_items'].append(explanation)
        row['evidence'] = '\n'.join(row['evidence_items'])
        for ref in refs:
            if ref not in row['evidence_sources']:
                row['evidence_sources'].append(ref)

    def insert_node(identifier, value):
        if identifier in nodes:
            raise QueryError('identity_collision', f'节点 ID 已被占用 {identifier}')
        nodes[identifier] = value

    for project_id, entry in entries.items():
        root, profile = entry['root'], entry['profile']
        active_statuses = Counter()
        counts = Counter()
        for row in entry['rows']:
            identifier = row['file_id']
            if identifier in files or identifier in nodes:
                raise QueryError('identity_collision', f'索引文件 ID 已被占用 {identifier}')
            file_path, is_file = paths.file(root, row['relative_path'])
            presence = row['presence']
            openable = presence == 'present' and is_file
            if presence == 'present' and not openable:
                issues.append(dict(code='indexed_file_unavailable', project_id=project_id, item=identifier,
                                   message=f'索引仍登记在场，原件不可访问 {row["relative_path"]}'))
            record = {
                **row, 'id': identifier, 'project_id': project_id, 'status': row['status'] or None,
                'absolute_path': str(file_path) if openable else None,
                'href': file_path.as_uri() if openable else None, 'openable': openable,
                'related_file_ids': [],
            }
            record['index_related_files'] = record.pop('related_files')
            files[identifier] = record
            profile['files'].append(identifier)
            counts[presence] += 1
            if not openable:
                continue
            active_statuses[row['status'] or 'unconfirmed'] += 1
            ref = describe_ref(core, knowledge, project_id, root, row['relative_path'],
                               row['name'], identifier, record['status'], None, file_path)
            insert_node(identifier, {
                'id': identifier, 'type': 'source', 'title': row['name'], 'project_id': project_id,
                'project_ids': [project_id], 'description': row['purpose'] or None, 'status': record['status'],
                'source_files': [ref],
            })
            add_edge(project_id, project_id, identifier, 'indexed_file',
                     ['RPM FILE_INDEX.csv 登记的在场文件。'], 'index_membership')
        profile['file_summary'] = {'total': len(profile['files']), 'openable': sum(active_statuses.values()),
                                   'by_presence': dict(counts), 'by_status': dict(active_statuses)}
        for key, claim in entry['nodes'].items():
            share_key = claim['share_key']
            shared_identity = share_key is not None and share_key not in invalid_shares
            identifier = knowledge.identity('shared', share_key) if shared_identity else knowledge.identity('knowledge', project_id, key)
            local[project_id, key] = identifier
            if identifier not in nodes:
                insert_node(identifier, {
                    'id': identifier, 'type': claim['kind'], 'title': claim['title'], 'project_id': project_id,
                    'project_ids': [], 'description': claim['summary'], 'status': claim['status'],
                    'source_files': [], 'claims': [], 'shared': False,
                })
            node = nodes[identifier]
            if 'claims' not in node or node['type'] != claim['kind'] or node['title'].casefold() != claim['title'].casefold():
                raise QueryError('identity_collision', f'知识节点身份冲突 {identifier}')
            node['project_ids'].append(project_id)
            node['shared'] = len(node['project_ids']) > 1
            node['claims'].append({
                'project_id': project_id, 'local_id': key, 'description': claim['summary'], 'status': claim['status'],
                'usage_context': method_context(claim['kind'], claim['status']), 'source_files': [],
                'method_usage': entry['annotations'].get(key, {}).get('method_usage'),
                'status_origin': 'project_config' if key == 'direction' else
                                 entry['annotations'].get(key, {}).get('status_origin', 'unspecified'),
            })
            add_edge(project_id, project_id, identifier, 'membership',
                     ['来自该项目配置中的研究方向。' if key == 'direction' else '由该项目 RPM_KNOWLEDGE.yaml 明确登记。'],
                     'project_membership')
            if claim['kind'] in {'deliverable', 'paper', 'patent'}:
                profile['deliverables'].append(identifier)

    def add_ref(project_id, evidence):
        root = entries[project_id]['root']
        indexed = evidence['file_id'] or None
        existing = files.get(indexed) if indexed else None
        if indexed and (not existing or not existing['openable'] or existing['project_id'] != project_id):
            raise ValueError(f'无在场来源文件 {indexed}')
        ref = describe_ref(core, knowledge, project_id, root, evidence['path'], evidence['title'],
                           indexed, existing['status'] if existing else None, evidence['evidence'])
        identifier = ref['id']
        if not indexed and identifier not in nodes:
            insert_node(identifier, {
                'id': identifier, 'type': 'source', 'title': evidence['title'], 'project_id': project_id,
                'project_ids': [project_id], 'description': 'RPM 项目管理记录', 'status': None,
                'source_files': [{**ref, 'evidence': None}],
            })
        node = nodes[identifier]
        if node['type'] != 'source' or node['project_id'] != project_id:
            raise QueryError('identity_collision', f'来源记录身份冲突 {identifier}')
        return ref

    for project_id, entry in entries.items():
        root = entry['root']
        for key, claim in entry['nodes'].items():
            node = nodes[local[project_id, key]]
            refs = [add_ref(project_id, evidence) for evidence in claim['sources']]
            next(x for x in node['claims'] if x['project_id'] == project_id)['source_files'] = refs
            node['source_files'].extend(refs)
            for ref in refs:
                add_edge(project_id, node['id'], ref['id'], 'source', [ref['evidence']], 'knowledge_citation', [ref])
        for (start, end, kind), evidence in entry['relations']:
            source, target = local[project_id, start], local[project_id, end]
            refs = [add_ref(project_id, item) for item in evidence]
            add_edge(project_id, source, target, kind, [ref['evidence'] for ref in refs], 'research_relation', refs)
        for index, item in enumerate(entry['file_relations'], 1):
            tag = f'.rpm/relations.json#{index}'
            if not isinstance(item, dict) or any(not isinstance(item.get(k), str) for k in ('source','target','kind','evidence')):
                issues.append(dict(code='invalid_file_relation', project_id=project_id, item=tag, message='文件关系字段格式无效'))
                continue
            source, target = item['source'], item['target']
            description = item['evidence'].strip()
            kind = item['kind']
            if source == target or not description or kind not in project.RELATIONS:
                issues.append(dict(code='invalid_file_relation', project_id=project_id, item=tag, message='文件关系类型、端点或依据无效'))
                continue
            if not all(fid in files and fid in nodes and files[fid]['project_id'] == project_id for fid in (source, target)):
                issues.append(dict(code='inactive_file_relation', project_id=project_id, item=tag, message='关系端点缺失、失效或跨越项目边界'))
                continue
            ref = add_ref(project_id, {'file_id': '', 'path': f'{core.MANAGEMENT}/.rpm/relations.json',
                                      'title': 'RPM 文件关系记录', 'evidence': description})
            add_edge(project_id, source, target, kind, [description], 'file_relation', [ref])
            for left, right in ((source, target), (target, source)):
                if right not in files[left]['related_file_ids']:
                    files[left]['related_file_ids'].append(right)
    return nodes, files, edges


def describe_ref(core, knowledge, project_id, root, relative, title, file_id, status, evidence, path=None):
    path = path or core.inside(root, relative)
    note_identity = knowledge.identity('source', project_id, file_id or relative.casefold())
    return {
        'id': file_id or note_identity, 'file_id': file_id, 'rpm_source_id': note_identity,
        'title': title, 'project_id': project_id, 'path': str(path), 'relative_path': relative,
        'href': path.as_uri(), 'status': status, 'evidence': evidence,
        'origin': 'indexed_file' if file_id else 'management_record',
    }

def scope_payload(payload, requested):
    if not requested:
        return payload
    projects = [item for item in payload['projects'] if item['id'] == requested]
    if not projects:
        raise QueryError('project_unavailable', f'已登记项目无法读取 {requested}')
    nodes = []
    for original in payload['nodes']:
        if requested not in original['project_ids']:
            continue
        item = deepcopy(original)
        item['project_id'] = requested
        item['project_ids'] = [requested]
        item['source_files'] = [ref for ref in item['source_files'] if ref['project_id'] == requested]
        if 'claims' in item:
            item['claims'] = [claim for claim in item['claims'] if claim['project_id'] == requested]
            item['description'] = item['claims'][0]['description']
            item['status'] = item['claims'][0]['status']
        nodes.append(item)
    return {
        'projects': projects,
        'files': [item for item in payload['files'] if item['project_id'] == requested],
        'nodes': nodes, 'edges': [item for item in payload['edges'] if item['project_id'] == requested],
        'issues': [item for item in payload['issues'] if requested == item.get('project_id')
                   or requested in item.get('project_ids', [])],
    }


def snapshot(api, settings, requested=None, conditional=None, previous_inputs=None):
    core = api[0]
    started = perf_counter()
    for _ in range(3):
        # Capture settings/registry before resolving or reading their contents.
        before_settings = stamp(settings)
        home, register, registered = input_registry(api, settings, requested)
        roots, tracked, issues = roots_and_stamps(api, home, settings, register, registered)
        if tracked[settings] != before_settings or api[3].registry(home) != registered:
            continue
        paths = SnapshotPaths(core)
        validation = None
        if not issues:
            try:
                validation = inputs_signature(api, roots, tracked, paths)
            except (OSError, ValueError, KeyError, TypeError):
                # A bad or incomplete input follows the normal validation/reporting path.
                paths = SnapshotPaths(core)
        check_finished = perf_counter()
        mtime = max((value[1] for value in tracked.values() if value is not None), default=None)
        updated = datetime.fromtimestamp(mtime / 1e9).astimezone().isoformat() if mtime is not None else None
        if conditional and previous_inputs and validation == previous_inputs:
            if any(stamp(path) != value for path, value in tracked.items()):
                continue
            return {
                'ok': True, 'schema_version': SCHEMA, 'revision': conditional,
                'generated_at': core.now(), 'data_updated_at': updated, 'scope': requested, 'not_modified': True,
                'registry_complete': True, 'input_stamp': validation,
                'timing_ms': {'input_check': round((check_finished - started) * 1000), 'fast_path': True},
            }
        entries = project_entries(api, roots, issues)
        parsed = perf_counter()
        nodes, files, edges = build_graph(api, entries, issues, paths)
        built = perf_counter()
        if any(stamp(path) != value for path, value in tracked.items()):
            continue
        for node in nodes.values():
            claims = node.get('claims')
            if not claims or len(claims) < 2:
                continue
            node['description'] = None
            initial_status = claims[0]['status']
            node['status'] = initial_status if all(c['status'] == initial_status for c in claims) else None
        payload = scope_payload({
            'projects': [entry['profile'] for entry in entries.values()],
            'files': sort_rows(files), 'nodes': sort_rows(nodes), 'edges': sort_rows(edges),
            'issues': issues,
        }, requested)
        registry_complete = len(entries) == len(registered)
        revision = hashlib.sha256(json.dumps([SCHEMA, requested, registry_complete, payload], ensure_ascii=False,
                                             separators=(',', ':'), sort_keys=True).encode('utf-8')).hexdigest()
        header = {'ok': True, 'schema_version': SCHEMA, 'revision': revision,
                  'generated_at': core.now(), 'data_updated_at': updated,
                  'not_modified': revision == conditional, 'scope': requested,
                  'registry_complete': registry_complete,
                  'input_stamp': validation if registry_complete and not issues else None,
                  'timing_ms': {'input_check': round((check_finished - started) * 1000),
                                'record_parse': round((parsed - check_finished) * 1000),
                                'graph_build': round((built - parsed) * 1000),
                                'revision_encode': round((perf_counter() - built) * 1000),
                                'fast_path': False}}
        if header['not_modified']:
            return header
        return {**header, **payload}
    raise QueryError('unstable_inputs', 'RPM 权威记录在读取过程中变化，请刷新重试')


def resolve_file(api, settings, project_id, identifier):
    result = snapshot(api, settings, project_id)
    item = next((row for row in result['files'] if row['id'] == identifier), None)
    if item and not item['openable']:
        raise QueryError('file_unavailable', '索引原件目前不可用')
    node = next((row for row in result['nodes'] if row['id'] == identifier and row['type'] == 'source'), None)
    if not node:
        raise QueryError('file_not_found', '未能在本项目有效索引或证据记录中找到该 ID')
    ref, = node['source_files']
    root = api[0].project_root(result['projects'][0]['root'])
    path = api[0].inside(root, ref['relative_path'])
    if not path.is_file():
        raise QueryError('file_unavailable', '该原件在定位过程中失效')
    return {'ok': True, 'schema_version': SCHEMA, 'project_id': project_id,
            'file': {**ref, 'path': str(path), 'href': path.as_uri()}, 'revision': result['revision']}


def material_catalog(api, settings, project_id, category, offset, limit):
    core, _, project, _, _, _ = api
    if not project_id or (category is not None and category not in core.DIRECTORIES):
        raise QueryError('invalid_request', '须提供项目 ID 和有效的 RPM 分类')
    if not 0 <= offset <= 2147483647 or not 1 <= limit <= 100:
        raise QueryError('invalid_request', '材料分页参数超出范围')
    home, _, registry = input_registry(api, settings, project_id)
    root = core.project_root(registry[project_id])
    if core.overlaps(root, home) or core.config(root).get('project_id') != project_id:
        raise QueryError('project_unavailable', 'RPM 登记与项目目录不一致')
    rows = [row for row in project.load_index(root) if row['presence'] == 'present']
    counts = Counter(row['category'] for row in rows)
    matches = sorted(
        (row for row in rows if row['category'] == category),
        key=lambda row: (row['relative_path'].casefold(), row['file_id']),
    ) if category else []
    return {
        'ok': True, 'schema_version': SCHEMA, 'total': counts[category] if category else len(rows),
        'categories': [{'id': name, 'count': counts[name]} for name in core.DIRECTORIES],
        'files': matches[offset:offset + limit],
    }


def cli():
    parser = Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--skill-root', type=Path, default=DEFAULT_SKILL)
    parser.add_argument('--settings', type=Path)
    operations = parser.add_subparsers(dest='command', required=True)
    snap = operations.add_parser('snapshot', allow_abbrev=False)
    snap.add_argument('--project-id')
    snap.add_argument('--if-revision')
    resolve = operations.add_parser('resolve-file', allow_abbrev=False)
    resolve.add_argument('--project-id', required=True)
    resolve.add_argument('--file-id', required=True)
    # Transport alias accepted by the current Stage 3 adapter's existing read-only allowlist.
    transport = operations.add_parser('context', allow_abbrev=False)
    modes = transport.add_mutually_exclusive_group(required=True)
    modes.add_argument('--knowledge-network', action='store_true')
    modes.add_argument('--resolve-evidence', action='store_true')
    modes.add_argument('--material-files', action='store_true')
    modes.add_argument('--material-catalog', action='store_true')
    transport.add_argument('--skill-root', dest='transport_skill_root', type=Path)
    transport.add_argument('--project-id')
    transport.add_argument('--file-id')
    transport.add_argument('--material-id', action='append', default=[])
    transport.add_argument('--material-category')
    transport.add_argument('--material-offset', type=int, default=0)
    transport.add_argument('--material-limit', type=int, default=30)
    transport.add_argument('--if-revision')
    transport.add_argument('--if-input-stamp')
    return parser.parse_args()


def run():
    args = cli()
    project_id = args.project_id
    file_id = getattr(args, 'file_id', None)
    previous = getattr(args, 'if_revision', None)
    if project_id is not None and not RPM_ID.fullmatch(project_id):
        raise QueryError('invalid_request', '项目 ID 须为 RPM 的 32 位十六进制标识')
    if previous is not None and not re.fullmatch(r'[a-f0-9]{64}', previous):
        raise QueryError('invalid_request', '修订号须为接口返回的 64 位十六进制标识')
    skill = (getattr(args, 'transport_skill_root', None) or args.skill_root).resolve()
    api = load_api(skill)
    settings = (args.settings or skill / 'local.json').absolute()
    if getattr(args, 'material_catalog', False):
        return material_catalog(api, settings, project_id, args.material_category,
                                args.material_offset, args.material_limit)
    if getattr(args, 'material_files', False):
        ids = args.material_id
        if not project_id or not 1 <= len(ids) <= 30 or not all(RPM_ID.fullmatch(item) for item in ids):
            raise QueryError('invalid_request', '须提供项目 ID 及 1–30 个材料 ID')
        core, _, project, _, _, _ = api
        _, _, registry = input_registry(api, settings, project_id)
        root = core.project_root(registry[project_id])
        indexed = {row['file_id']: row for row in project.load_index(root) if row['file_id'] in ids}
        rows = [indexed[item] for item in dict.fromkeys(ids) if item in indexed
                and indexed[item]['presence'] == 'present'
                and core.inside(root, indexed[item]['relative_path']).is_file()]
        return {'ok': True, 'schema_version': SCHEMA, 'files': rows}
    resolving = args.command == 'resolve-file' or getattr(args, 'resolve_evidence', False)
    if resolving:
        if not project_id or not file_id or not RPM_ID.fullmatch(file_id) or previous:
            raise QueryError('invalid_request', '解析文件需要项目 ID 和来源 ID')
        return resolve_file(api, settings, project_id, file_id)
    if file_id is not None:
        raise QueryError('invalid_request', '快照操作不接受文件 ID')
    previous_inputs = getattr(args, 'if_input_stamp', None)
    if previous_inputs is not None and (not previous or not re.fullmatch(r'[a-f0-9]{64}', previous_inputs)):
        raise QueryError('invalid_request', '输入校验须对应已知修订号')
    return snapshot(api, settings, project_id, previous, previous_inputs)


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    try:
        result = run()
    except QueryError as error:
        print(json.dumps({'ok': False, 'schema_version': SCHEMA, 'code': error.code, 'error': str(error)},
                         ensure_ascii=False))
        return 2
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'ok': False, 'schema_version': SCHEMA, 'code': 'read_failed', 'error': str(error)},
                         ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
