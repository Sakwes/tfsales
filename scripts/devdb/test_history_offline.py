import contextlib
import io
import unittest
from unittest.mock import MagicMock, patch
import verify_history
from migrate import load_plan
from target import PROJECT_REF


class HistoryTests(unittest.TestCase):
    def test_default_never_connects(self):
        with patch('sys.argv', ['verify_history.py']), patch('verify_history.connect_verified', side_effect=AssertionError('Forbidden')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(verify_history.main(), 0)

    def test_exact_prefix_and_no_extras_or_wrong_projects(self):
        plan = load_plan()[:18]
        rows = [(p, h, PROJECT_REF) for p, h, _ in plan]
        self.assertEqual(len(verify_history.compare_history(list(reversed(rows)), plan)), 18)
        bad = list(rows); bad[0] = (bad[0][0], '0'*64, PROJECT_REF)
        foreign = list(rows); foreign[0] = (foreign[0][0], foreign[0][1], 'other')
        for altered in (rows[:-1], rows + [rows[0]], bad, foreign):
            with self.subTest(count=len(altered)), self.assertRaises(ValueError):
                verify_history.compare_history(altered, plan)

    def test_read_only_is_checked_before_history_query(self):
        conn = MagicMock(); conn.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = ('on',)
        conn.execute.return_value.fetchall.return_value = [(p, h, PROJECT_REF) for p, h, _ in load_plan()[:18]]
        with patch('verify_history.connect_verified', return_value=conn) as connect:
            self.assertTrue(verify_history.verify()['matches'])
        connect.assert_called_once_with(read_only=True)
        self.assertEqual([c.args[0] for c in conn.execute.call_args_list], [
            'SET TRANSACTION READ ONLY', 'SHOW transaction_read_only',
            'SELECT path,sha256,project_ref FROM sellnova_dev.migration_history'])

    def test_read_only_failure_stops_before_ledger_and_closes(self):
        conn = MagicMock(); conn.__enter__.return_value = conn
        conn.execute.return_value.fetchone.return_value = ('off',)
        with patch('verify_history.connect_verified', return_value=conn), self.assertRaises(ValueError):
            verify_history.verify()
        self.assertEqual(conn.execute.call_count, 2)
        conn.__exit__.assert_called_once()

    def test_error_output_hides_connection_details(self):
        out = io.StringIO()
        with patch('sys.argv', ['verify_history.py', '--check']), patch('verify_history.verify', side_effect=RuntimeError('synthetic-secret')), contextlib.redirect_stdout(out):
            self.assertEqual(verify_history.main(), 1)
        self.assertNotIn('synthetic-secret', out.getvalue())


if __name__ == '__main__':
    unittest.main(verbosity=2)
