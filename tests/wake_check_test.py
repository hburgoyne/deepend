import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('wake_check', Path(__file__).parents[1] / 'agent/examples/wake_check.py')
wake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wake)


class WakeCheckTests(unittest.TestCase):
    def test_idle_has_no_worker_or_model_call(self):
        with tempfile.NamedTemporaryFile(mode='w') as key:
            key.write('w' * 43)
            key.flush()
            with patch.object(wake.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value.__enter__.return_value.read.return_value = b'{"pending":false}'
                self.assertEqual(wake.check('https://agent.example.test', key.name), {'pending': False})
                req = opener.return_value.open.call_args.args[0]
                self.assertEqual(req.full_url, 'https://agent.example.test/v1/wake')
                self.assertEqual(req.get_header('Authorization'), 'Bearer ' + 'w' * 43)

    def test_insecure_origins_and_redirects_rejected(self):
        for origin in ['http://agent.test', 'https://user:secret@agent.test', 'https://agent.test/path']:
            with self.assertRaises(ValueError):
                wake.check(origin, '/unused')
        self.assertIsNone(wake.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.test'))

    def test_failures_are_not_idle_and_do_not_leak_error_body(self):
        for code in [401, 429, 302]:
            with patch.dict(os.environ, {'DEEPEND_AGENT_ORIGIN': 'https://agent.test', 'DEEPEND_WAKE_KEY_FILE': '/unused'}), patch.object(wake, 'check', side_effect=HTTPError('https://agent.test', code, 'secret', {'Retry-After': '90'}, None)), patch('sys.stdout', new_callable=io.StringIO) as out:
                self.assertEqual(wake.main(), 2)
                payload = json.loads(out.getvalue())
                self.assertEqual(payload['error'], 'http_' + str(code))
                self.assertNotIn('secret', out.getvalue())
                if code == 429:
                    self.assertEqual(payload['retry_after_seconds'], 90)


if __name__ == '__main__':
    unittest.main()
