"""Two explicit live scans. New posts between scans are legitimate discoveries."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from facebook_collector.cli import main

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python facebook_collector/scripts/test_incremental.py GROUP_ID')
    for _ in range(2):
        code = main(['posts', 'sync', sys.argv[1]])
        if code:
            sys.exit(code)
