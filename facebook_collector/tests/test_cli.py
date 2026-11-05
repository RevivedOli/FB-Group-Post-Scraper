import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class CLITests(unittest.TestCase):
    def test_age_flags_are_mutually_exclusive_and_support_fractional_values(self):
        from ..cli import parser
        args = parser().parse_args(['posts','sync','123','--max-age-days','0.5','--stop-at-cutoff'])
        self.assertEqual(args.max_age_days,0.5)
        self.assertTrue(args.stop_at_cutoff)
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable,'-m','facebook_collector.cli','--data-dir',directory,
                                     'posts','sync','123','--max-age-days','1','--max-age-hours','2'],capture_output=True,text=True)
            self.assertEqual(result.returncode,2)
            self.assertIn('not allowed',result.stderr)

    def test_clean_install_commands_without_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            def command(*args, expected=0):
                result = subprocess.run([sys.executable,'-m','facebook_collector.cli','--data-dir',directory,*args],
                                        capture_output=True,text=True,timeout=20)
                self.assertEqual(result.returncode,expected,result.stdout+result.stderr)
                self.assertNotIn('Traceback',result.stderr)
                return json.loads(result.stdout)
            self.assertEqual(command('init')['status'],'ready')
            account = command('account','add','--label','Offline CLI','--no-login')['id']
            self.assertEqual(len(command('account','list')),1)
            command('group','add','123','--account',account,'--access-basis','Synthetic registration only')
            self.assertEqual(len(command('group','list')),1)
            failed = command('posts','fetch','123',expected=1)
            self.assertEqual(failed['error'],'authentication_required')
            self.assertEqual(command('scans','list')[0]['status'],'failed')
            self.assertEqual(command('posts','list','123'),[])
            self.assertEqual(command('schedule','--once'),[])  # failed manual attempt is backed off, not immediately due
            export = command('export','write',str(Path(directory)/'empty.jsonl'))
            self.assertEqual(export['records'],0)
            self.assertEqual(command('export','ack','--group','123','--post','900',expected=1)['error'],'unknown_post')
