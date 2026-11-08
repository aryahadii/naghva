#!/usr/bin/env python3
"""Print a fresh, unused item ID.

    python3 tools/newid.py [--count N]

Every item file under data/ (examples included) is checked so the ID is new.
"""

import argparse
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import datastore as ds  # noqa: E402


def existing_ids(root):
    return {path.stem for path in Path(root).rglob("%s*.yaml" % ds.ITEM_PREFIX)}


def new_id(taken):
    while True:
        candidate = ds.ITEM_PREFIX + "".join(secrets.choice(ds.ID_ALPHABET) for _ in range(ds.ID_LENGTH))
        if candidate not in taken:
            return candidate


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--count", type=int, default=1, help="how many to print")
    parser.add_argument("--root", default=str(ds.DEFAULT_ROOT), help="directory to scan (default: data)")
    args = parser.parse_args(argv)
    taken = existing_ids(args.root)
    for _ in range(args.count):
        candidate = new_id(taken)
        taken.add(candidate)
        print(candidate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
