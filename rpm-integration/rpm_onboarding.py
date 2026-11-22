"""Preview and register historical projects through the installed RPM 2.0."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import os
from pathlib import Path
import re
import sys
from types import SimpleNamespace

from rpm_knowledge_api import QueryError, load_api

MAX_FILES = 50000
DUPLICATE_BYTES = 512 * 1024 * 1024
HASH_LIMIT = 32 * 1024 * 1024
REVIEW_RECORD = 'onboarding-review.json'
RECOVERY_MARKER = '.rpm-onboarding-confirmation.json'
RECOVERY_LOCK = '.rpm-onboarding.lock'
OPERATION_ID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
MARKDOWN_LINK = re.compile(r'(?<!!)\[\[([^\]#|]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]')
PATH_HINTS = tuple((i, role, re.compile(pattern, re.I)) for i, role, pattern in (
    (1, '研究规划', r'研究规划|研究方案|文章大修方案|开题|实施计划|研究大纲|research[ _-]*(?:plan|proposal)'),
    (2, '文献或参考资料', r'文献综述|参考文献|文献库|(?:^|[/ _-])literature(?:$|[/ _-])|literature[ _-]*review'),
    (3, '设计或实现工作', r'结构设计|设计说明|源代码|(?:^|/)(?:src|scripts)(?:/|$)|实现说明'),
    (6, '试验或执行记录', r'试验记录|实验记录|校准记录|测试记录|运行记录|(?:test|experiment)[ _-]*log'),
    (7, '数据分析或验证', r'敏感性分析|优化结果|后处理|验证报告|数据汇总|postprocess|validation[ _-]*report'),
    (9, '论文、专利或工作文档', r'论文(?:草稿|初稿|修订)|专利(?:申请|交底|草案)|技术报告|manuscript|(?:^|/)(?:论文|专利|docs)(?:/|$)'),
    (10, '正式提交或交付材料', r'交付清单|验收材料|投稿准备清单|阶段性进展汇报|课题进展汇报|(?:^|/)(?:release|submission)(?:/|$)'),
    (11, '历史备份', r'(?:^|[/ _-])(?:archive|backup|before)(?:$|[/ _-])|备份|写回前|扩展前|更新前'),
))


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fingerprint(info):
    return str(info.st_dev), str(info.st_ino), str(info.st_size), str(info.st_mtime_ns), str(info.st_ctime_ns)


def rpm_context(api, settings, selected, recovery=None):
    core, _, project, vault, _, _ = api
    root = core.project_root(selected)
    if not root.is_dir():
        raise QueryError('invalid_root', '项目文件夹已经不可访问。')
    home = vault.vault_location(settings)
    if home is None or not home.is_dir():
        raise QueryError('vault_unconfigured', 'RPM 尚未配置可访问的中央 Vault。')
    if core.overlaps(root, home):
        raise QueryError('protected_root', '项目与中央 Vault 的目录必须独立。')
    registered = vault.registry(home)
    for location in registered.values():
        other = core.project_root(location)
        if core.overlaps(other, root) and not (recovery and other == root):
            raise QueryError('already_managed', '此目录已登记，或与其他 RPM 项目的路径重叠。请选择已有项目进行绑定。')
    for parent in root.parents:
        if (parent / core.MANAGEMENT / 'PROJECT_CONFIG.yaml').is_file():
            raise QueryError('already_managed', '所选文件夹位于已有 RPM 项目内。')
    manage = core.inside(root, core.MANAGEMENT)
    if manage.exists() and not recovery:
        raise QueryError('already_managed', '此目录已有 RPM 管理记录。请保留原记录并通过 RPM 核对登记或恢复。')
    if not recovery and core.inside(root, RECOVERY_MARKER).exists():
        raise QueryError('recovery_needed', '此目录已有未完成的 RPM 接管记录。请在原预览中重试，或从 RPM 核对登记状态。')
    for directory in core.DIRECTORIES[1:]:
        target = core.inside(root, directory)
        if target.exists() and not target.is_dir():
            raise QueryError('invalid_root', '项目标准目录被同名文件占用。')
    return core, project, vault, root, home


def inventory(core, project, root, choices, home):
    files, skipped = project.walk(root)
    if len(files) > MAX_FILES:
        raise QueryError('preview_limit', '文件数量超过单次接管的安全预览上限，请按独立项目分批接管。')
    direct = []
    nested = []
    for child in root.iterdir():
        stat = child.lstat()
        if core.reparse(stat):
            skipped.append(child.name)
        if child.is_dir() and not core.reparse(stat):
            direct.append((child.name, fingerprint(stat)))
    # A child project excluded by RPM's scan must not be silently treated as part of the new project.
    for folder, dirs, _ in os.walk(root):
        for name in dirs[:]:
            current = Path(folder) / name
            if name in {'.git', '.svn', '.hg', '.obsidian', '.venv', 'node_modules', '__pycache__'} or core.reparse(current.lstat()):
                dirs.remove(name)
            elif (current / core.MANAGEMENT / 'PROJECT_CONFIG.yaml').is_file():
                nested.append(current.relative_to(root).as_posix())
                dirs.remove(name)
    stamps = {rel: fingerprint(info) for rel, info in files.items()}
    skipped = sorted(set(skipped + nested))
    revision = core.digest(json_text([str(root), str(home), list(choices), sorted(direct), skipped, stamps]).encode('utf-8'))
    return files, stamps, skipped, revision


def final_group(mapping):
    return [(key, sorted(value, key=str.casefold)) for key, value in mapping.items() if len(value) > 1]


def stable_hash(core, path, saved):
    try:
        if core.reparse(path.lstat()) or fingerprint(path.lstat()) != saved:
            return None
        digest = core.file_hash(path)
        return digest if fingerprint(path.lstat()) == saved else None
    except OSError:
        return None


def suggestions(core, rel, identified, excerpt):
    # Headings and titles express purpose more reliably than references mentioned in the body.
    beginning = ' '.join(excerpt.split()[:100])[:650]
    path_roles = {i: purpose for i, purpose, rule in PATH_HINTS if rule.search('/' + rel)}
    headline = {i: purpose for i, purpose, rule in PATH_HINTS if rule.search(beginning)}
    rank = identified['confidence']
    standard_name = Path(rel).parts[0]
    standard = standard_name in core.DIRECTORIES[1:]
    if standard_name == core.DIRECTORIES[11]:
        return standard_name, '历史备份或工作记录', '原目录明确用于保留历史记录。', 'medium'
    if 11 in path_roles and not standard:
        return core.DIRECTORIES[11], path_roles[11], '版本名称或原目录提示历史备份。请核对。', 'medium'
    if standard:
        category_index = core.DIRECTORIES.index(standard_name)
        if category_index in headline:
            path_roles[category_index] = headline[category_index]
    agreed = (headline.keys() & path_roles.keys()) - {11}
    if len(agreed) == 1:
        index = next(iter(agreed))
        if not standard or core.DIRECTORIES[index] == standard_name:
            return core.DIRECTORIES[index], headline[index], '文档开头与文件名或目录的用途线索一致。', 'high'
    if standard and (rank != 'high' or identified['category'] == standard_name):
        return standard_name, identified['purpose'] or '已有目录内资料', '沿用已有标准目录。请核对用途。', 'medium'
    if len(headline) == 1 and beginning:
        index, purpose = next(iter(headline.items()))
        if not standard or core.DIRECTORIES[index] == standard_name:
            return core.DIRECTORIES[index], purpose, '标题或开头提示用途。请核对。', 'medium'
    if len(path_roles) == 1 and not standard:
        index, purpose = next(iter(path_roles.items()))
        if rank != 'high' or identified['category'] == core.DIRECTORIES[index]:
            return core.DIRECTORIES[index], purpose, '文件名或原目录提示用途。请核对。', 'medium'
    if not standard and identified['file_type'] in {'CAD', 'CAE'}:
        return core.DIRECTORIES[4], '工程模型，具体用途待核对', '模型格式可识别，工程归属需核对。', 'medium'
    if rank == 'high' and not standard and not headline and not path_roles:
        return identified['category'], identified['purpose'], '正文或格式提示用途，尚缺少独立佐证。', 'medium'
    return (identified['category'], identified['purpose'],
            '正文、目录或格式线索不足或不一致，需人工判断。', 'pending')


def recovery_record(core, root, operation):
    marker = core.inside(root, RECOVERY_MARKER)
    if not marker.exists():
        return marker, None
    info = marker.lstat()
    if core.reparse(info) or not marker.is_file() or info.st_nlink != 1 or info.st_size > 16 * 1024 * 1024:
        raise QueryError('recovery_needed', '接管检查点无法安全读取。')
    attempt = core.json_load(marker, None)
    if (not isinstance(attempt, dict) or attempt.get('schema') != 2 or
            not OPERATION_ID.fullmatch(operation or '') or attempt.get('operation') != operation):
        raise QueryError('recovery_needed', '存在另一接管留下的管理记录，请保留记录并核对原任务。')
    return marker, attempt


def make_preview(api, settings, selected, request):
    core = api[0]
    _, attempt = recovery_record(core, core.project_root(selected), request.get('operation'))
    core, project, vault, root, home = rpm_context(api, settings, selected, attempt)
    if attempt and attempt['vault'] != str(home):
        raise QueryError('recovery_needed', '中央 Vault 已更改，请恢复先前配置。')
    from classification import classify
    from rpm_dependency_refs import apply_dependencies
    choices = (request['name'], request['direction'], request['projectType'])
    configuration = project.configuration(
        root, '0' * 32,
        SimpleNamespace(name=choices[0], direction=choices[1], type=[choices[2]] if choices[2] else []),
        [],
    )
    files, stamps, skipped, revision = inventory(core, project, root, choices, home)
    directories = Counter()
    duplicate_sizes = defaultdict(list)
    name_paths = defaultdict(list)
    note_names = defaultdict(list)
    for rel, info in files.items():
        item = Path(rel)
        directories[item.parts[0] if len(item.parts) > 1 else ''] += 1
        duplicate_sizes[info.st_size].append(rel)
        name_paths[item.name.casefold()].append(rel)
        if item.suffix.casefold() in {'.md', '.markdown'}:
            note_names[item.stem.casefold()].append(rel)

    checks, duplicate_unverified = defaultdict(list), 0
    budget = DUPLICATE_BYTES
    for size, identical in sorted(duplicate_sizes.items()):
        if len(identical) < 2:
            continue
        for rel in sorted(identical, key=str.casefold):
            if size > HASH_LIMIT or size > budget:
                duplicate_unverified += 1
                continue
            target = core.inside(root, rel)
            digest = stable_hash(core, target, stamps[rel])
            budget -= size
            if digest is None:
                duplicate_unverified += 1
            else:
                checks[digest].append(rel)
    duplicate_groups = final_group(checks)
    same_name_groups = final_group(name_paths)
    duplicate_map = {rel: f'D{n}' for n, (_, group) in enumerate(duplicate_groups, 1) for rel in group}
    same_name_map = {rel for _, group in same_name_groups for rel in group}

    prior = request.get('previous') or {}
    rows, links, observations = [], [], {}
    reclassified = added = 0
    for rel, info in sorted(files.items(), key=lambda item: item[0].casefold()):
        target = core.inside(root, rel)
        saved = prior.get(rel)
        reused = isinstance(saved, dict) and list(stamps[rel]) == saved.get('stamp')
        if reused:
            row = {key: saved['row'][key] for key in ('path', 'name', 'category', 'purpose', 'reason',
                                                       'confidence', 'group', 'fileType', 'size')}
            labels = saved['wikiLabels']
            dependency = saved['baseDependency']
        else:
            result = classify(target, rel, {})
            excerpt = result['content']
            category, purpose, reason, confidence = suggestions(core, rel, result, excerpt)
            group = result['group']
            dependency = ('工程工作目录' if group else '工程格式或外部依赖待核查' if result['protected'] else
                          '硬链接文件' if info.st_nlink > 1 else '')
            if target.name.casefold() in {'requirements.txt', 'requirements-dev.txt', 'package-lock.json',
                                         'poetry.lock', 'uv.lock', 'pipfile.lock', 'cargo.lock'}:
                dependency = '软件环境依赖清单'
            labels = (MARKDOWN_LINK.findall(excerpt)[:100] if target.suffix.casefold() in {'.md', '.markdown'} else [])
            row = {'path': rel, 'name': target.name, 'category': category, 'purpose': purpose, 'reason': reason,
                   'confidence': confidence, 'group': group, 'fileType': result['file_type'], 'size': info.st_size}
            reclassified += 1
            added += rel not in prior
        if fingerprint(target.lstat()) != stamps[rel]:
            raise QueryError('stale_preview', '预览期间文件发生变化，请重新扫描。')
        for label in labels:
            if len(links) >= 100:
                break
            qualified = label.strip().removesuffix('.md')
            exact = [candidate for candidate in (qualified + '.md', qualified + '.markdown') if candidate in files]
            matches = exact or note_names.get(Path(qualified).name.casefold(), [])
            if len(matches) == 1 and matches[0] != rel:
                claim = {'source': rel, 'target': matches[0], 'type': '笔记引用', 'reason': '文件正文中有可解析的双链，科研关系待核对。'}
                if claim not in links:
                    links.append(claim)
        row.update(dependency=dependency, duplicateGroup=duplicate_map.get(rel, ''),
                   sameName=rel in same_name_map, changed=bool(prior) and not reused)
        rows.append(row)
        observations[rel] = {'stamp': stamps[rel], 'wikiLabels': labels, 'baseDependency': dependency}
    dependency_summary = apply_dependencies(core, root, files, stamps, rows, fingerprint)
    rank = Counter(row['confidence'] for row in rows)
    return {
        'revision': revision, 'projectType': '+'.join(configuration['types']),
        'observations': observations, 'recoveryHash': attempt['request_hash'] if attempt else '',
        'dependencySummary': dependency_summary,
        'changeSummary': {'reused': len(rows) - reclassified, 'reclassified': reclassified, 'added': added,
                          'changed': reclassified - added, 'removed': len(set(prior) - set(files))},
        'categories': list(core.DIRECTORIES[1:]),
        'summary': {
            'total': len(rows), 'high': rank['high'], 'medium': rank['medium'], 'pending': rank['pending'],
            'dependencyProtected': sum(bool(row['dependency']) for row in rows),
            'duplicateGroups': len(duplicate_groups), 'duplicateFiles': sum(len(group) for _, group in duplicate_groups),
            'duplicateUnverified': duplicate_unverified, 'sameNameGroups': len(same_name_groups), 'skipped': len(skipped),
        },
        'directories': [{'path': directory, 'count': count} for directory, count in sorted(directories.items())],
        'blocked': '部分文件或嵌套项目无法安全归入原位基线，请先核对排除项。' if skipped else '',
        'skipped': skipped, 'files': rows, 'knowledgeCandidates': links,
    }


def set_checkpoint(core, marker, attempt, **values):
    prior = core.file_hash(marker)
    attempt.update(values)
    core.put(marker, json_text(attempt), expected=prior)


def result_from_index(core, project, root, project_id):
    report = core.json_load(core.work_path(root, REVIEW_RECORD), {})
    rows = [row for row in project.load_index(root) if row['presence'] == 'present']
    reviewed = report['records']
    return {'project_id': project_id, 'review': report['counts'],
            'registeredFiles': [[row['relative_path'], row['file_id']] for row in rows],
            'pendingFiles': [row['relative_path'] for row in rows
                             if reviewed.get(row['relative_path'], {}).get('action', 'pending') == 'pending']}


def validate_approval(core, files, request):
    for rel, review in request['review'].items():
        if rel not in files or review['action'] not in {'accept', 'change', 'pending'}:
            raise QueryError('invalid_review', '复核决定或文件路径无效。')
        if review['action'] != 'pending' and (
            review['category'] not in core.DIRECTORIES[1:] or not review['purpose'].strip()
        ):
            raise QueryError('invalid_review', '已确认资料必须有有效的分类和用途。')


def check_inventory(core, project, root, choices, home, request, fresh=False):
    files, stamps, skipped, revision = inventory(core, project, root, choices, home)
    observed = {rel: list(fingerprint) for rel, fingerprint in stamps.items()}
    if skipped or observed != request['baseline'] or (fresh and revision != request['revision']):
        raise QueryError('stale_preview', '接管期间文件、目录或中央 Vault 已变化。请重新扫描，已有复核选择将保留。')
    return files


def apply_under_lock(api, settings, selected, request):
    core = api[0]
    marker, attempt = recovery_record(core, core.project_root(selected), request['operation'])
    core, project, vault, root, home = rpm_context(api, settings, selected, attempt)
    digest = core.digest(json_text(request).encode('utf-8'))
    choices = (request['name'], request['direction'], request['projectType'])
    if attempt and attempt['vault'] != str(home):
        raise QueryError('recovery_needed', '中央 Vault 已更改，请先核对未完成的接管。')
    if attempt and attempt['stage'] == 'synced':
        data = core.config(root)
        if vault.registry(home).get(data['project_id']) != str(root) or data['project_id'] != attempt['projectId']:
            raise QueryError('recovery_needed', '已同步检查点与中央登记不一致。')
        return result_from_index(core, project, root, data['project_id'])
    if not attempt or attempt['request_hash'] != digest:
        if attempt and request.get('expectedRecoveryHash') != attempt['request_hash']:
            raise QueryError('recovery_needed', '变更先前批准的项目资料需要重新扫描并确认。')
        files = check_inventory(core, project, root, choices, home, request, fresh=True)
        validate_approval(core, files, request)
        if attempt:
            set_checkpoint(core, marker, attempt, request_hash=digest, stage='approved', revision=request['revision'])
        else:
            attempt = {'schema': 2, 'operation': request['operation'], 'request_hash': digest,
                       'stage': 'approved', 'revision': request['revision'], 'vault': str(home)}
            core.put(marker, json_text(attempt), create=True)
    else:
        check_inventory(core, project, root, choices, home, request)

    if core.inside(root, core.MANAGEMENT + '/.rpm/moves.json').exists():
        raise QueryError('recovery_needed', '检测到独立的 RPM 文件移动日志，请先在 RPM 中核对。')
    config_fields = SimpleNamespace(name=choices[0], direction=choices[1], type=[choices[2]] if choices[2] else [])
    project.initialize(root, config_fields)
    with core.lock(core.work_path(root, 'project.lock')):
        data = core.config(root)
        project_id = data['project_id']
        if attempt.get('projectId', project_id) != project_id:
            raise QueryError('recovery_needed', '项目 ID 与接管检查点不一致。')
        registered = vault.registry(home)
        if any(location == str(root) and identifier != project_id for identifier, location in registered.items()):
            raise QueryError('recovery_needed', '已存在不一致的中央登记，请核对项目路径和身份。')
        index_path = core.control_path(root, 'FILE_INDEX.csv')
        if attempt['stage'] == 'indexed':
            if not index_path.is_file() or core.file_hash(index_path) != attempt['indexDigest']:
                raise QueryError('stale_preview', 'RPM 文件索引在中断期间发生变化。请重新扫描。')
        else:
            set_checkpoint(core, marker, attempt, stage='initialized', projectId=project_id)
            check_inventory(core, project, root, choices, home, request)
            first_scan = project.scan(root, data, organize=False)
            check_inventory(core, project, root, choices, home, request)
            rows = {row['relative_path']: row for row in project.load_index(root) if row['presence'] == 'present'}
            counts = Counter({'confirmed': 0, 'corrected': 0, 'pending': 0, 'changedDuringApply': 0})
            entries = {}
            for rel, review in request['review'].items():
                row = rows.get(rel)
                if not row or not row['sha256']:
                    counts['pending'] += 1
                    entries[rel] = {'action': 'pending', 'reason': '登记期间无法核实文件，请重新核对。'}
                    continue
                entries[rel] = {**review, 'file_id': row['file_id'], 'sha256': row['sha256']}
                if review['action'] == 'pending':
                    counts['pending'] += 1
                    continue
                override = {'category': review['category'], 'purpose': review['purpose'], 'sha256': row['sha256']}
                data.setdefault('file_overrides', {})[row['file_id']] = override
                counts['corrected' if review['action'] == 'change' else 'confirmed'] += 1
            if counts['confirmed'] or counts['corrected']:
                config_path = core.control_path(root, 'PROJECT_CONFIG.yaml')
                core.put(config_path, core.yaml_dump(data), expected=core.file_hash(config_path))
                project.scan(root, data, organize=False)
            counts['pending'] += max(0, len(rows) - sum(rel in rows for rel in entries))
            core.json_put(core.work_path(root, REVIEW_RECORD), {
                'schema': 2, 'operation': request['operation'], 'revision': request['revision'], 'created_at': core.now(),
                'counts': dict(counts), 'records': entries, 'scan_skipped': first_scan['skipped'],
            })
            set_checkpoint(core, marker, attempt, stage='indexed', indexDigest=core.file_hash(index_path),
                           registeredFileCount=len(rows))
        check_inventory(core, project, root, choices, home, request)
    vault.sync(home, root, data)
    set_checkpoint(core, marker, attempt, stage='synced')
    return result_from_index(core, project, root, project_id)


def apply_review(api, settings, selected, request):
    core = api[0]
    root = core.project_root(selected)
    if not OPERATION_ID.fullmatch(request.get('operation') or ''):
        raise QueryError('invalid_review', '接管任务标识无效。')
    _, attempt = recovery_record(core, root, request['operation'])
    if not attempt:
        _, project, _, root, home = rpm_context(api, settings, selected)
        choices = (request['name'], request['direction'], request['projectType'])
        check_inventory(core, project, root, choices, home, request, fresh=True)
    with core.lock(core.inside(root, RECOVERY_LOCK)):
        return apply_under_lock(api, settings, selected, request)


def finish_review(api, settings, selected, request):
    core = api[0]
    root = core.project_root(selected)
    with core.lock(core.inside(root, RECOVERY_LOCK)):
        marker, attempt = recovery_record(core, root, request.get('operation'))
        if attempt:
            if attempt['stage'] != 'synced' or attempt['projectId'] != request.get('projectId'):
                raise QueryError('recovery_needed', '接管尚未完成，请保留检查点。')
            marker.unlink()
    return {}


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('action', choices=['preview', 'apply', 'finish'])
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--settings', required=True, type=Path)
    parser.add_argument('--skill-root', required=True, type=Path)
    args = parser.parse_args()
    try:
        request = json.load(sys.stdin)
        api = load_api(args.skill_root)
        result = {'preview': make_preview, 'apply': apply_review, 'finish': finish_review}[args.action](
            api, args.settings, args.root, request)
        print(json_text({'ok': True, **result}))
    except QueryError as error:
        print(json_text({'ok': False, 'code': error.code, 'error': str(error)}))
    except (OSError, TypeError, ValueError, KeyError, RuntimeError) as error:
        print(json_text({'ok': False, 'code': 'onboarding_failed', 'error': str(error)[:480]}))


if __name__ == '__main__':
    main()
