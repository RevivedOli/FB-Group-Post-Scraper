"""Explicit permitted live scan, bounded to 20 records."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from facebook_collector.cli import main

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python facebook_collector/scripts/test_posts.py GROUP_ID')
    sys.exit(main(['posts', 'fetch', sys.argv[1], '--limit', '20']))
