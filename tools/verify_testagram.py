#!/usr/bin/env python3
"""Dependency-free Testagram parity smoke check.

Checks the public canonical site for reachability and audits the checked-in
React router/page surface so CI does not mistake an unauthenticated HTML crawl
for proof of private-screen parity.
"""
from __future__ import annotations

import pathlib
import re
import sys
import urllib.request

URL = "https://www.testagram.site/"
ROOT = pathlib.Path(__file__).resolve().parents[1]

SURFACE = {
    "Home": ("src/pages/HomePage.tsx", "/"),
    "Explore": ("src/pages/ExplorePage.tsx", "/explore"),
    "Threads": ("src/pages/ThreadsPage.tsx", "/threads"),
    "Notifications": ("src/pages/NotificationsPage.tsx", "/notifications"),
    "Messages": ("src/pages/MessagesPage.tsx", "/messages"),
    "Spaces": ("src/pages/SpacesPage.tsx", "/spaces"),
    "AI": ("src/pages/AIPage.tsx", "/ai"),
    "Communities": ("src/pages/CommunitiesPage.tsx", "/communities"),
    "Profile": ("src/pages/ProfilePage.tsx", "/profile/:username"),
    "Auth": ("src/pages/AuthPage.tsx", "/auth"),
    "Premium": ("src/pages/PremiumPage.tsx", "/premium"),
    "Settings": ("src/pages/SettingsPage.tsx", "/settings"),
}


def check_site() -> bool:
    request = urllib.request.Request(URL, headers={"User-Agent": "TestagramReplicaVerifier/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode("utf-8", errors="replace")
            print(f"LIVE: HTTP {response.status} {URL}")
            # A client-rendered SPA may not contain navigation text in raw HTML.
            # Only use this as informational evidence, never as a failure gate.
            visible = [name for name in SURFACE if name in body]
            print("LIVE: labels in raw HTML: " + (", ".join(visible) if visible else "none (client-rendered)"))
            return 200 <= response.status < 400
    except Exception as exc:
        print(f"LIVE: ERROR: {exc}", file=sys.stderr)
        return False


def check_repo() -> bool:
    app_file = ROOT / "src" / "App.tsx"
    if not app_file.exists():
        print(f"REPO: missing {app_file}", file=sys.stderr)
        return False
    app = app_file.read_text(encoding="utf-8")
    failures: list[str] = []
    for name, (page, route) in SURFACE.items():
        page_path = ROOT / page
        if not page_path.exists():
            failures.append(f"{name}: missing {page}")
            continue
        if route not in app and route != "/profile/:username":
            failures.append(f"{name}: route {route!r} not found in App.tsx")
        if name == "Profile" and ":username" not in app:
            failures.append("Profile: dynamic username route not found in App.tsx")
    if failures:
        print("REPO: parity failures:")
        for failure in failures:
            print("  - " + failure)
        return False
    print(f"REPO: {len(SURFACE)} primary surfaces and page implementations present.")
    return True


def main() -> int:
    live_ok = check_site()
    repo_ok = check_repo()
    if not live_ok:
        return 1
    if not repo_ok:
        return 2
    print("OK: Testagram parity smoke checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
