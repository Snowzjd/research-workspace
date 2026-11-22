"""Explicitly register one scoped Codex output using RPM's authoritative index."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid

from rpm_knowledge_api import input_registry, load_api


PROTECTED_ID_HASHES = {'ae428f0f9a857d151ccb32517d77a3a4e78106d7cb021b8064866250be65c26d', '68df7416ee6f059dd6b7c0b07cc224775917d9dce92d8db40a7754dd372ba20a'}
PROTECTED_ROOT_HASHES = {'2dd8e6631f65c8ebc9cab65beeaab5e795b499aea8b962b796b5778440d5c861', 'd97959f9b3b8ff8c1aa0877a52523745438d96ca7d0e5a0a4e830ee9e14419c0'}


def checked_artifact(core, root, relative):
    parts = relative.split('/')
    if (not parts or len(relative) > 2048 or any(
        not part or part.startswith('.') or part.endswith(('.', ' ')) or
        re.search(r'[:\\\x00-\x1f]', part) or part.casefold() in
        {'skills', 'node_modules', '00_project_management'} or
        re.search(r'(?:^|[._-])(?:secret|credentials?|auth|tokens?|api[_-]?key|private[_-]?key|password|device)(?:[._-]|$)', part, re.I)
        for part in parts
    )):
        raise ValueError('产物相对路径无效')
    current = root
    for part in parts:
        current = current / part
        info = current.lstat()
        if core.reparse(info):
            raise ValueError('产物或上级目录经过系统链接')
        if current != root / Path(*parts) and (current / core.MANAGEMENT / 'PROJECT_CONFIG.yaml').is_file():
            raise ValueError('文件属于另一独立项目')
    target = core.inside(root, relative)
    info = target.lstat()
    if not target.is_file() or info.st_nlink != 1:
        raise ValueError('产物不存在或不是普通文件')
    return target, info


def fingerprint(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def register(args):
    if not re.fullmatch(r'[a-f0-9]{32}', args.project_id):
        raise ValueError('RPM 项目无效')
    api = load_api(Path(args.skill_root))
    core, _, project, _, _, _ = api
    root = core.project_root(args.root)
    _, _, registry = input_registry(api, Path(args.settings), args.project_id)
    if core.project_root(registry[args.project_id]) != root:
        raise ValueError('项目根目录与 RPM 登记不一致')
    protected_id = hashlib.sha256(args.project_id.encode('utf-8')).hexdigest() in PROTECTED_ID_HASHES
    protected_path = os.name == 'nt' and any(
        hashlib.sha256(item.as_posix().lower().encode('utf-8')).hexdigest() in PROTECTED_ROOT_HASHES
        for item in (root, *root.parents)
    )
    if protected_id or protected_path:
        raise ValueError('此项目当前只读，正式索引未修改')
    target, initial = checked_artifact(core, root, args.file)
    with core.lock(core.work_path(root, 'project.lock')):
        if core.config(root)['project_id'] != args.project_id:
            raise ValueError('项目配置与绑定不符')
        index = core.control_path(root, 'FILE_INDEX.csv')
        if index.lstat().st_nlink != 1:
            raise ValueError('索引指向链接')
        expected = core.file_hash(index)
        rows = project.load_index(root)
        relative = target.relative_to(root).as_posix()
        existing = next((row for row in rows if os.path.normcase(row['relative_path']) == os.path.normcase(relative)), None)
        digest = core.file_hash(target)
        if fingerprint(initial) != fingerprint(checked_artifact(core, root, args.file)[1]):
            raise ValueError('登记期间文件发生变化，请核对后重试')
        source = 'Codex 任务产物 · 人工确认原位登记'
        if existing:
            if existing['presence'] != 'present' or existing['sha256'] != digest:
                raise ValueError('已有索引条目与当前文件不一致，请在 RPM 中复核')
            return {'ok': True, 'fileId': existing['file_id']}
        info = project.classify(target, relative, {})
        file_id = uuid.uuid4().hex
        row = {key: info[key] for key in ('file_type', 'category', 'purpose', 'confidence', 'reason', 'group')}
        matching = next((r['file_id'] for r in rows if r['presence'] == 'present' and r['sha256'] == digest), '')
        row.update(file_id=file_id, name=target.name, relative_path=relative, size=str(initial.st_size),
                   mtime_ns=str(initial.st_mtime_ns), sha256=digest, presence='present', duplicate_of=matching,
                   reason=f"{source}。{row['reason']}")
        if fingerprint(initial) != fingerprint(checked_artifact(core, root, args.file)[1]):
            raise ValueError('登记期间文件发生变化，请核对后重试')
        project.save_index(root, sorted([*rows, row], key=lambda item: item['relative_path'].casefold()), expected)
        # The CSV transaction is authoritative. The reason on the row records this explicit registration.
        return {'ok': True, 'fileId': file_id}


def main():
    parser = argparse.ArgumentParser()
    for name in ('skill-root', 'settings', 'root', 'project-id', 'file'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        result = register(args)
    except (OSError, ValueError, KeyError) as error:
        message = str(error) if isinstance(error, ValueError) else '无法读取项目索引或产物，已取消本次操作'
        result = {'ok': False, 'error': message[:250]}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
