#!/usr/bin/env python3
"""Static checks for the VPS-free/serverless architecture.

This script intentionally does not run a web server. It validates that client
code does not contain common server-secret patterns and that Edge Functions
exist for the production payment entry points.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]

FORBIDDEN_CLIENT_PATTERNS = [
    re.compile(r"MPESA_(?:CONSUMER_KEY|CONSUMER_SECRET|PASSKEY)"),
    re.compile(r"SUPABASE_SERVICE_ROLE_KEY"),
]
REQUIRED_FUNCTIONS = {
    "mpesa-stk-push",
    "mpesa-callback",
    "mpesa-b2c-payout",
    "pesapal-create-order",
}


def main() -> int:
    errors: list[str] = []

    functions_dir = ROOT / "supabase" / "functions"
    for name in REQUIRED_FUNCTIONS:
        if not (functions_dir / name / "index.ts").is_file():
            errors.append(f"Missing Edge Function: {name}")

    for path in (ROOT / "src").rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in FORBIDDEN_CLIENT_PATTERNS:
            if pattern.search(text):
                errors.append(f"Server secret reference in client source: {path}")

    if errors:
        print("EDGE ARCHITECTURE CHECK: FAILED")
        for error in errors:
            print(f"- {error}")
        return 1

    print("EDGE ARCHITECTURE CHECK: PASS")
    print("- No VPS/server process is required by this validation layer.")
    print("- Payment credentials are expected to remain in Edge Function secrets.")
    print("- Required payment Edge Functions are present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
