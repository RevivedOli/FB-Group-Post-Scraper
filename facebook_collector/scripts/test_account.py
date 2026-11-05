"""Explicit live operator command; never run by the offline test suite."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from facebook_collector.cli import main

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python facebook_collector/scripts/test_account.py ACCOUNT_ID')
    sys.exit(main(['account', 'test', sys.argv[1]]))
