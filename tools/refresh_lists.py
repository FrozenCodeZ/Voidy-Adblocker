#!/usr/bin/env python3
"""
Refresh every block list from its source, then rebuild Voidy's rule files.
Run this right before building a release, so the bundled lists are as fresh as
possible (new installs start from them):

    python tools/refresh_lists.py

It reads data/list-sources.json, downloads each plain-domain list into
../list-sources/hagezi, updates the EasyList checkout in ../easylist-source
(cloning it the first time), and runs build_static_rules.py and build_lists.py.
Only data is downloaded. If a download fails, the old copy is kept and the script
says so, so check its output before releasing.
"""
import json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "..", "list-sources", "hagezi")
EASY = os.path.join(ROOT, "..", "easylist-source")
EASYLIST_REPO = "https://github.com/easylist/easylist.git"
TIMEOUT = 90


def download(urls, dest):
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "voidy-build-script"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                data = r.read()
            if len(data) < 1000:
                raise ValueError(f"only {len(data)} bytes")
            tmp = dest + ".new"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            return url, len(data)
        except Exception as e:
            print(f"    failed {url}: {e}")
    return None, 0


def main():
    config = json.load(open(os.path.join(ROOT, "data", "list-sources.json"), encoding="utf-8"))
    os.makedirs(SOURCES, exist_ok=True)
    failures = 0
    for cat, c in config["categories"].items():
        for src in c["sources"]:
            if src["format"] != "domains":
                continue
            print(f"{cat:9} {src['name']}")
            url, size = download(src["urls"], os.path.join(SOURCES, src["file"]))
            if url:
                print(f"    ok  {size:>9,} bytes from {url}")
            else:
                failures += 1
                print("    KEPT THE OLD COPY")
    print("EasyList checkout")
    if os.path.isdir(os.path.join(EASY, ".git")):
        r = subprocess.run(["git", "-C", EASY, "pull", "--ff-only", "-q"])
    else:
        r = subprocess.run(["git", "clone", "--depth", "1", "-q", EASYLIST_REPO, EASY])
    if r.returncode:
        failures += 1
        print("    git failed: the old EasyList copy is used")
    for script in ("build_static_rules.py", "build_lists.py"):
        print(f"\n== {script}")
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", script), EASY] + ([SOURCES] if script == "build_static_rules.py" else []))
        if r.returncode:
            sys.exit(f"{script} failed")
    print(f"\nDone. {failures} download(s) failed." + (" Review them before releasing." if failures else " The bundled lists are fresh."))


if __name__ == "__main__":
    main()
