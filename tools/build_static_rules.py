#!/usr/bin/env python3
"""
Voidy static ruleset builder.

Builds the three always-on domain rulesets the manifest ships:

  rules/security.json  malware, phishing, scam and fake-shop domains and IPs
                       (HaGeZi Threat Intelligence Feeds "mini" + its IP list + HaGeZi Fake)
  rules/ads.json       ad servers (EasyList + EasyList Adult ad-server lists,
                       HaGeZi Pop-Up Ads)
  rules/privacy.json   trackers (EasyPrivacy domain rules, plus the rest of
                       HaGeZi Multi PRO's ad/tracking domains)

Each domain lands in exactly one file, in that order (security first), so the
popup counts a blocked request under one category. A domain is skipped when a
parent domain is already listed (Chrome's requestDomains also matches
subdomains). Rules never touch the page you navigate to (no main_frame); the
background turns the security list into a "this site is dangerous" warning page
for navigations.

Usage (from the extension folder):
    git clone --depth 1 https://github.com/easylist/easylist.git ../easylist-source
    (download each "domains" source listed in data/list-sources.json, saved under its "file" name, into ../list-sources/hagezi;
     that folder holds every plain domain list, HaGeZi's and URLhaus's)
    python tools/build_static_rules.py ../easylist-source ../list-sources/hagezi

Licences: EasyList/EasyPrivacy (GPL-3.0-or-later or CC BY-SA 3.0+),
HaGeZi dns-blocklists (GPL-3.0). See THIRD-PARTY-NOTICES.md.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EASY = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "easylist-source")
HAGEZI = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "..", "list-sources", "hagezi")

# ---- Settings: data/list-sources.json ----------------------------------------
# Sources, project-maintained entries (curated) and the never-block list live in
# one file that the extension's automatic updater (src/list-updates.js) also reads.
CONFIG = json.load(open(os.path.join(ROOT, "data", "list-sources.json"), encoding="utf-8"))
CHUNK = CONFIG["domainsPerRule"]
NEVER_BLOCK = set(CONFIG["neverBlock"])


DOMAIN = re.compile(r"^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$")
# "||example.com^" or "||example.com^$third-party" (nothing more specific)
ABP_DOMAIN = re.compile(r"^\|\|([a-z0-9._-]+)\^(\$third-party)?$")


def read_lines(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith(("#", "!", "["))]


def hagezi(names):
    out = set()
    for n in names:
        for d in read_lines(os.path.join(HAGEZI, n)):
            d = d.lower()
            if DOMAIN.match(d):
                out.add(d)
    return out


def abp(files):
    """Plain domain rules from Adblock-syntax lists: {domain: third_party_only}."""
    out = {}
    for rel in files:
        p = os.path.join(EASY, rel)
        if not os.path.exists(p):
            print("  (missing, skipped)", rel); continue
        for line in read_lines(p):
            m = ABP_DOMAIN.match(line)
            if m and ("." in m.group(1)):
                d, tp = m.group(1), bool(m.group(2))
                out[d] = out.get(d, True) and tp          # any unrestricted entry wins
    return out


def parent_in(d, s):
    parts = d.split(".")
    return any(".".join(parts[i:]) in s for i in range(1, len(parts) - 1))


def listed(d, s):
    return d in s or parent_in(d, s)


def never(d):
    return d in NEVER_BLOCK


def rules_for(domains_any, domains_tp, start_id):
    rules, rid = [], start_id
    for doms, tp in ((sorted(domains_any), False), (sorted(domains_tp), True)):
        for i in range(0, len(doms), CHUNK):
            cond = {"requestDomains": doms[i:i + CHUNK]}
            if tp:
                cond["domainType"] = "thirdParty"
            rules.append({"id": rid, "priority": 1, "action": {"type": "block"}, "condition": cond})
            rid += 1
    return rules


def easylist_files(src):
    """EasyList repository files that make up a source's sections."""
    files = []
    for sec in src["sections"]:
        if sec.endswith("/"):
            folder = os.path.join(EASY, sec)
            files += sorted(sec + f for f in os.listdir(folder) if f.endswith(".txt")
                            and not any(k in f for k in src.get("skipSections", [])))
        else:
            files.append(sec)
    return files


def main():
    # (EasyPrivacy's PerimeterX file is skipped: it is anti-bot protection, and
    # blocking it can lock people out of logins and checkouts.)
    sources = {}
    for cat, c in CONFIG["categories"].items():
        abp_doms, hz = {}, set(c.get("curated", []))
        for src in c["sources"]:
            if src["format"] == "abp":
                abp_doms.update(abp(easylist_files(src)))
            else:
                hz |= hagezi([src["file"]])
        sources[cat] = (abp_doms, hz)
    taken, stats = set(), {}
    for cat in ("security", "ads", "privacy"):
        abp_doms, hz = sources[cat]
        any_, tp = set(), set()
        for d, third_only in abp_doms.items():
            (tp if third_only else any_).add(d)
        any_ |= hz
        tp -= any_
        # drop never-block domains, domains an earlier category owns, and
        # subdomains whose parent is already listed here
        for group in (any_, tp):
            for d in list(group):
                if never(d) or listed(d, taken):
                    group.discard(d)
        any_ = {d for d in any_ if not parent_in(d, any_)}
        tp = {d for d in tp if not parent_in(d, tp) and not listed(d, any_)}
        rules = rules_for(any_, tp, 1)
        with open(os.path.join(ROOT, "rules", cat + ".json"), "w") as f:
            json.dump(rules, f, separators=(",", ":"))
        taken |= any_ | tp
        stats[cat] = f"{len(rules)} rules, {len(any_)} domains + {len(tp)} third-party-only"
    for k, v in stats.items():
        print(f"{k:9} {v}")
    # How old the OLDEST source is: a fresh install counts the bundled lists as updated at that
    # moment (src/list-updates.js), so it never overstates how fresh they are.
    import subprocess
    times = [os.path.getmtime(os.path.join(HAGEZI, src["file"])) for c in CONFIG["categories"].values()
             for src in c["sources"] if src["format"] == "domains" and os.path.exists(os.path.join(HAGEZI, src["file"]))]
    try:
        times.append(int(subprocess.check_output(["git", "-C", EASY, "log", "-1", "--format=%ct"], text=True).strip()))
    except Exception:
        pass
    with open(os.path.join(ROOT, "data", "build-info.json"), "w") as f:
        json.dump({"builtAt": int(min(times) * 1000) if times else 0}, f)


if __name__ == "__main__":
    main()
