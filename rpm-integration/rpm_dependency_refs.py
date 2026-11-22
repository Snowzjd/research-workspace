"""Read-only dependency hints from explicit references in an RPM scan scope."""
from collections import Counter
from pathlib import Path, PureWindowsPath
import posixpath
import re
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile


TEXT_LIMIT = 4 * 1024 * 1024
ZIP_XML_LIMIT = 2 * 1024 * 1024
PACKAGE_LIMIT = 512 * 1024 * 1024
SCAN_BUDGET = 96 * 1024 * 1024
MAX_REFERENCES = 5000
SCRIPT_TYPES = {
    '.py', '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.m', '.r', '.jl', '.js', '.ts',
    '.jou', '.wbjn', '.mac', '.tcl', '.vbs', '.scr', '.scm',
}
MODEL_TEXT = {'.wbpj', '.xml', '.k', '.inp', '.dat', '.json', '.yaml', '.yml', '.toml', '.catfct'}
OFFICE_PACKAGES = {'.docx', '.xlsx', '.pptx', '.xlsm', '.docm', '.pptm'}
MODEL_PACKAGES = {'.scdoc', '.scdocx', '.fcstd', '.f3d', '.iam', '.ipj'}
RESOURCE_TYPES = {
    *SCRIPT_TYPES, *MODEL_TEXT, *OFFICE_PACKAGES, *MODEL_PACKAGES,
    '.md', '.txt', '.csv', '.tsv', '.h5', '.hdf5', '.cas', '.msh', '.stp', '.step',
    '.sldprt', '.sldasm', '.par', '.asm', '.prt', '.igs', '.iges', '.stl', '.x_t', '.x_b',
    '.nas', '.bdf', '.cdb', '.rst', '.pdf', '.png', '.jpg', '.svg', '.mat', '.npy', '.npz',
}
QUOTED = re.compile(r'''["']([^"'\r\n]{1,700})["']''')
FILE_ARGUMENT = re.compile(
    r"""\b(?:open|read_\w+|load\w*|import\w*|save\w*|write\w*|readfile|source|Get-Content|Import-Csv|Join-Path|Path|Document|Workbooks\.Open|ReadAllText)\s*(?:\(\s*|\s+)["']?$"""
    r"""|(?:/?file[/ \t]+(?:read|write)[\w-]*|\*include|#include)\s*["']?$"""
    r"""|(?:[\w$]*(?:file|path|filename|src|href|input|output|target|model|template)|source|data|final)\s*[:=]\s*["']?$""", re.I)
JOURNAL_OPERAND = re.compile(
    r'^\s*(?:/?file[/ \t]+(?:read|write)[\w-]*|\*include|source)\s+([^\s"\x27]+)', re.I)
MODEL_ATTRS = {'href', 'src', 'file', 'filename', 'filepath', 'path', 'resource', 'source', 'target'}


def resource_like(value):
    return Path(value.replace('\\', '/')).suffix.casefold() in RESOURCE_TYPES


def script_references(text):
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith(('#', '//', ';', '%', 'REM ')) and not stripped.lower().startswith('#include'):
            continue
        for match in QUOTED.finditer(line):
            value = match[1]
            if resource_like(value) and FILE_ARGUMENT.search(line[:match.start()].removesuffix('r').removesuffix('R')):
                yield value, number, 'script_operand'
        match = JOURNAL_OPERAND.match(line)
        if match and resource_like(match[1]):
            yield match[1], number, 'script_operand'


def xml_references(content, office):
    xml_prefix = content.replace(b'\0', b'').upper()
    if b'<!DOCTYPE' in xml_prefix or b'<!ENTITY' in xml_prefix:
        return
    try:
        root = ET.fromstring(content)
    except (ET.ParseError, ValueError):
        return
    for element in root.iter():
        name = element.tag.rsplit('}', 1)[-1]
        if office:
            if name == 'Relationship' and element.get('TargetMode', '').casefold() == 'external':
                value = element.get('Target', '')
                if value:
                    yield value, None, 'office_external'
            continue
        if name == 'Relationship' and element.get('TargetMode', '').casefold() != 'external':
            continue
        for key, value in element.attrib.items():
            if key.rsplit('}', 1)[-1].casefold() in MODEL_ATTRS and resource_like(value):
                yield value, None, 'model_reference'


def package_references(file, office, bytes_left):
    try:
        with ZipFile(file) as archive:
            for entry in archive.infolist():
                name = entry.filename.casefold()
                if entry.is_dir() or not (name.endswith('.rels') or (not office and (name.endswith('.xml') and ('document' in name or 'assembly' in name)))):
                    continue
                if entry.file_size > min(ZIP_XML_LIMIT, bytes_left[0]):
                    bytes_left[1] = True
                    continue
                bytes_left[0] -= entry.file_size
                yield from xml_references(archive.read(entry), office)
    except (OSError, BadZipFile, RuntimeError, ValueError, NotImplementedError):
        return


def resolve_reference(root, source, raw, by_path):
    value = raw.strip()
    if not value or len(value) > 700 or '\x00' in value:
        return None
    if re.search(r'\$[({]|\$\w|%\w+%|\{[^}]+\}', value):
        return 'dynamic_unresolved', None
    try:
        decoded = urlsplit(value)
    except ValueError:
        return 'dynamic_unresolved', None
    if decoded.scheme.casefold() == 'file':
        if decoded.netloc and decoded.netloc.casefold() != 'localhost':
            return 'external_unverified', None
        value = unquote(decoded.path)
        if re.match(r'^/[A-Za-z]:', value):
            value = value[1:]
    elif decoded.scheme and not re.match(r'^[A-Za-z]:', value):
        return 'external_unverified', None
    value = value.replace('\\', '/')
    if value.startswith('//'):
        return 'external_unverified', None
    windows = PureWindowsPath(value)
    if windows.drive and not windows.root:
        return 'dynamic_unresolved', None
    if windows.anchor or value.startswith('/'):
        project = root.as_posix().rstrip('/')
        absolute = posixpath.normpath(value)
        if not absolute.casefold().startswith(project.casefold() + '/'):
            return 'external_unverified', None
        relative = absolute[len(project)+1:]
    else:
        relative = posixpath.normpath(posixpath.join(posixpath.dirname(source), value))
        if relative.startswith('../') or relative == '..':
            return 'external_unverified', None
    if relative == source:
        return None
    target = by_path.get(relative.casefold())
    return ('resolved', target) if target is not None else ('missing_in_scope', None)


def apply_dependencies(core, root, files, stamps, rows, fingerprint):
    """Apply exact project-relative evidence while leaving originals and external resources untouched."""
    by_path = {rel.casefold(): rel for rel in files}
    by_row = {row['path']: row for row in rows}
    summary = Counter()
    bytes_left = [SCAN_BUDGET, False]
    incoming = Counter()
    for source, info in files.items():
        ext = Path(source).suffix.casefold()
        if ext not in SCRIPT_TYPES | MODEL_TEXT | OFFICE_PACKAGES | MODEL_PACKAGES:
            continue
        if summary['references'] >= MAX_REFERENCES:
            bytes_left[1] = True
            break
        from_path = core.inside(root, source)
        if info.st_nlink > 1 or core.reparse(from_path.lstat()) or fingerprint(from_path.lstat()) != stamps[source]:
            continue
        if ext in OFFICE_PACKAGES | MODEL_PACKAGES:
            if info.st_size > PACKAGE_LIMIT:
                bytes_left[1] = True
                continue
            references = list(package_references(from_path, ext in OFFICE_PACKAGES, bytes_left))
        else:
            if info.st_size > min(TEXT_LIMIT, bytes_left[0]):
                bytes_left[1] = True
                continue
            try:
                with from_path.open('rb') as stream:
                    data = stream.read(TEXT_LIMIT + 1)
            except OSError:
                continue
            if len(data) > TEXT_LIMIT:
                bytes_left[1] = True
                continue
            bytes_left[0] -= len(data)
            if ext == '.xml':
                references = list(xml_references(data, False))
            else:
                encoding = 'utf-16' if data.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
                references = list(script_references(data.decode(encoding, errors='replace')))
        # Keep evidence scoped to the scanned version. Confirmation separately revalidates the inventory.
        if fingerprint(from_path.lstat()) != stamps[source]:
            continue
        seen = set()
        for raw, line, kind in references:
            key = (raw, line, kind)
            if key in seen:
                continue
            seen.add(key)
            resolved = resolve_reference(root, source, raw, by_path)
            if resolved is None:
                continue
            status, target = resolved
            row = by_row[source]
            row.setdefault('dependencyRefs', []).append({
                'kind': kind, 'status': status, 'path': raw, 'line': line, 'target': target,
            })
            if not row['dependency']:
                row['dependency'] = '含已解析工程引用' if status == 'resolved' else '工程引用待核对'
            if target:
                incoming[target] += 1
            summary['references'] += 1
            summary[status] += 1
            if summary['references'] >= MAX_REFERENCES:
                bytes_left[1] = True
                break
    for target, count in incoming.items():
        by_row[target]['dependency'] = '被工程文件明确引用'
        by_row[target]['dependencyIncoming'] = count
    return {**summary, 'partial': bytes_left[1]}
