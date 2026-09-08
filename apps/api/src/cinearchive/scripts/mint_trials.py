"""Mint Cinekive Pro trial keys (seller machine only).

  set CINEKIVE_TRIAL_SECRET=...   # required for production mint/verify
  python -m cinearchive.scripts.mint_trials --email a@x.com --email b@y.com

Packaged desktop must use the same CINEKIVE_TRIAL_SECRET.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mint 14-day Cinekive Pro trial keys")
    parser.add_argument("--email", action="append", default=[], help="Tester email (repeatable)")
    parser.add_argument("--count", type=int, default=0, help="Also mint N anonymous keys")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Write JSON receipt (default: stdout only)",
    )
    parser.add_argument(
        "--generate-secret",
        action="store_true",
        help="Print a new CINEKIVE_TRIAL_SECRET and exit",
    )
    args = parser.parse_args(argv)

    if args.generate_secret:
        print(secrets.token_urlsafe(32))
        return 0

    if not (os.environ.get("CINEKIVE_TRIAL_SECRET") or "").strip():
        print(
            "Set CINEKIVE_TRIAL_SECRET first (or pass --generate-secret).\n"
            "Use the same secret in packaged desktop env so keys verify.",
            file=sys.stderr,
        )
        return 2

    # Import after secret is set so module picks it up
    from cinearchive.services.trial_license import mint_trial

    emails = list(args.email)
    for i in range(max(0, args.count)):
        emails.append(f"tester-{i + 1}@trial.cinekive.local")
    if not emails:
        emails = [f"tester-{i}@trial.cinekive.local" for i in range(1, 6)]

    issued = []
    for idx, email in enumerate(emails, start=1):
        row = mint_trial(email=email, days=args.days, label=f"batch-{idx}")
        issued.append(row)
        exp = datetime.fromtimestamp(row["expires_at"], tz=timezone.utc).isoformat()
        print(f"\n#{idx}  {row['email']}")
        print(f"     key: {row['key']}")
        print(f"     exp: {exp}  jti={row['jti']}")

    receipt = {
        "minted_at": datetime.now(timezone.utc).isoformat(),
        "days": args.days,
        "keys": issued,
        "note": "Keep CINEKIVE_TRIAL_SECRET private. Regenerating requires a new mint.",
    }
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(f"\nWrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
