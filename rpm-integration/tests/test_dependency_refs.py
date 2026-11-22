"""Regression for resolved and uncertain engineering references."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rpm_dependency_refs import apply_dependencies, script_references


class Paths:
    @staticmethod
    def inside(root, relative):
        result = root / relative
        if result.is_symlink() or not result.is_relative_to(root):
            raise ValueError(relative)
        return result

    @staticmethod
    def reparse(info):
        return bool(getattr(info, 'st_file_attributes', 0) & 1024)


class DependencyReferences(unittest.TestCase):
    def test_scopes_operands_and_does_not_promote_duplicate_names(self):
        with TemporaryDirectory() as room:
            root = Path(room)
            items = {
                'work/run.jou': '/file read-case ../models/base.cas.h5\n/file/read-case "F:/SN2/old case.cas.h5"\n',
                'models/base.cas.h5': 'a',
                'another/base.cas.h5': 'b',
                'scripts/generate.py': 'FINAL=Path("../docs/final.docx")\nprint("../another/base.cas.h5")\nopen(missing)\n',
                'docs/final.docx': None,
                'docs/link.docx': None,
                'models/native.scdoc': None,
                'data/in.csv': '1',
                'scripts/other.ps1': '$path="' + root.as_posix() + '/data/in.csv"\n$path2="../data/missing.csv"\n',
            }
            for relative, text in items.items():
                p = root / relative
                p.parent.mkdir(parents=True, exist_ok=True)
                if text is not None:
                    p.write_text(text, encoding='utf8')
                else:
                    with ZipFile(p,'w') as bundle:
                        if relative == 'docs/link.docx':
                            bundle.writestr('word/_rels/document.xml.rels',
                                '<Relationships><Relationship TargetMode="External" Target="../data/in.csv" /></Relationships>')
                        elif relative.endswith('.scdoc'):
                            bundle.writestr('SpaceClaim/document.xml',
                                '<Model><Part file="../data/in.csv" /></Model>')
            def fingerprint(info):
                return (info.st_size, info.st_mtime_ns)
            files = {rel: (root / rel).stat() for rel in items}
            rows = [{'path': rel, 'dependency': ''} for rel in items]
            before = {rel: (root / rel).read_bytes() for rel in items}
            result = apply_dependencies(Paths, root, files, {rel:fingerprint(info) for rel,info in files.items()}, rows, fingerprint)
            by_path = {row['path']: row for row in rows}
            self.assertEqual(result['resolved'], 5)
            self.assertEqual(result['external_unverified'], 1)
            self.assertEqual(by_path['models/base.cas.h5']['dependencyIncoming'], 1)
            self.assertEqual(by_path['data/in.csv']['dependencyIncoming'], 3)
            self.assertEqual(by_path['another/base.cas.h5']['dependency'], '')
            self.assertNotIn('dependencyRefs', by_path['another/base.cas.h5'])
            self.assertEqual({rel: (root / rel).read_bytes() for rel in items}, before)

    def test_dynamic_templates_remain_unconfirmed(self):
        from rpm_dependency_refs import resolve_reference
        self.assertEqual(resolve_reference(Path('G:/Study'), 'work/source.ps1', '$input/out.csv', {}),
                         ('dynamic_unresolved', None))
        self.assertEqual(list(script_references('print("../models/base.step")')), [])


if __name__ == '__main__':
    unittest.main()
