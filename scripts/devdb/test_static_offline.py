"""Cross-platform path and historical migration integrity regressions; no SQL execution."""
import contextlib
import io
import json
from pathlib import Path, PureWindowsPath
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import check_static
import migrate


class StaticValidationTests(unittest.TestCase):
    def test_windows_historical_paths_match_posix_manifest(self):
        root = check_static.ROOT

        class WindowsMigration:
            def __init__(self, path):
                self.relative = PureWindowsPath(path.relative_to(root).as_posix())

            def relative_to(self, parent):
                return self.relative

            def __lt__(self, other):
                return self.relative < other.relative

        directory = MagicMock()
        directory.glob.return_value = [WindowsMigration(p) for p in (root/'supabase/migrations').glob('*.sql')]
        simulated_root = MagicMock()
        simulated_root.__truediv__.side_effect = lambda path: directory if path == 'supabase/migrations' else root/path
        with patch('check_static.ROOT', simulated_root), contextlib.redirect_stdout(io.StringIO()):
            check_static.main()

    def test_reordered_or_renamed_history_is_rejected(self):
        files = migrate.load_plan()
        reordered = [files[1], files[0], *files[2:]]
        renamed = [('supabase/migrations/changed.sql', *files[0][1:]), *files[1:]]
        for altered in (reordered, renamed):
            with self.subTest(path=altered[0][0]), patch('check_static.load_plan', return_value=altered):
                with self.assertRaises(AssertionError):
                    check_static.main()

    def test_changed_historical_sql_bytes_are_rejected(self):
        manifest = json.loads(migrate.MANIFEST.read_text())
        first = manifest['files'][0]['path']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sql = root/first
            sql.parent.mkdir(parents=True)
            sql.write_bytes((migrate.ROOT/first).read_bytes() + b'\n-- synthetic change\n')
            path = root/'manifest.json'
            path.write_text(json.dumps(manifest))
            with patch('migrate.ROOT', root), patch('migrate.MANIFEST', path):
                with self.assertRaisesRegex(ValueError, 'checksum'):
                    migrate.load_plan()


if __name__ == '__main__':
    unittest.main(verbosity=2)
