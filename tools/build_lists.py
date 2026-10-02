#!/usr/bin/env python3
"""
Voidy list builder.

Turns the maintained EasyList / Fanboy filter lists (Adblock Plus syntax) into
the two bundled data files the extension uses:

  data/netrules.json   network rules, per category, in Chrome DNR format
                       (installed by the background worker as dynamic rules, so
                       they can be switched off per site)
  data/cosmetic.json   element-hiding rules, indexed by class/id token so a page
                       only ever receives the selectors that could match it

Usage (from the extension folder):
    git clone --depth 1 https://github.com/easylist/easylist.git ../easylist
    python tools/build_lists.py ../easylist

Only DATA is produced. Nothing is downloaded at runtime and no code is
generated, so the extension stays Web-Store-safe (MV3: no remote code).
Filter lists: EasyList / Fanboy, used under their GPL-3.0-or-later option (see
THIRD-PARTY-NOTICES.md); keep the source notices with the built data.
"""
import json, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "..", "easylist")
# Opt-in, hand-curated phone / OS telemetry domains. These are maintained in
# this source file rather than imported from a third-party blocklist.
CURATED_TELEMETRY = ["iot-eu-logser.realme.com", "iot-logser.realme.com", "data.mistat.india.xiaomi.com",
                     "data.mistat.rus.xiaomi.com", "ngfts.lge.com", "settings-win.data.microsoft.com",
                     "watson.telemetry.microsoft.com", "device-metrics-us.amazon.com",
                     "vortex-win.data.microsoft.com", "telemetry.microsoft.com", "browser.events.data.msn.com",
                     "device-metrics-us-2.amazon.com"]

# Hand-picked third-party domains the bundled lists miss, by category. Each one
# only collects data or draws a widget; link redirectors, sign-in, video players
# and app feature switches are deliberately NOT here (blocking them breaks sites).
CURATED_EXTRA = {
    # cookie-consent managers (the "cookie banners" switch; off per site with "popups & widgets")
    "cookies": ["cdn.cookielaw.org", "cookies-data.onetrust.io", "consent.trustarc.com", "consent-pref.trustarc.com",
                "cdn.privacy-mgmt.com", "wrapper-api.sp-prod.net"],
    # share buttons and embedded social widgets (the opt-in "social widgets" switch)
    "social": ["st-widget.s3.amazonaws.com", "widgets.pinterest.com", "platform.twitter.com", "platform.instagram.com"],
    # viewing statistics only (the video itself comes from other hosts)
    "easyprivacy": ["fresnel.vimeocdn.com"],
}

# Real ad / analytics endpoints that EasyList, EasyPrivacy and HaGeZi
# miss. Blocked only when ANOTHER site calls them (third-party), so the vendors'
# own dashboards (e.g. TikTok Ads Manager) still work if you visit them.
CURATED_THIRD_PARTY = [
    "gemini.yahoo.com", "adtech.yahooinc.com", "analytics.query.yahoo.com", "log.fc.yahoo.com", "udcm.yahoo.com",
    "partnerads.ysm.yahoo.com", "metrika.yandex.ru", "appmetrica.yandex.ru", "adfstat.yandex.ru", "offerwall.yandex.net",
    "unityads.unity3d.com", "ads.tiktok.com", "ads-api.tiktok.com", "ads-sg.tiktok.com", "business-api.tiktok.com",
    "analytics.tiktok.com", "log.byteoversea.com", "ads-api.twitter.com", "ads-api.x.com", "an.facebook.com",
    "analyticsengine.s3.amazonaws.com", "analytics.s3.amazonaws.com", "advice-ads.s3.amazonaws.com", "adtago.s3.amazonaws.com",
]

# ---- category -> source files -------------------------------------------
# Order matters only for de-duplication (first category wins a shared rule).
CATS = {
    # Includes EasyList's ad-server list (only servers the bundled static list
    # doesn't already cover end up here) and EasyList Adult (its own ad
    # servers, third-party and site-specific rules, and element hiding).
    "ads":           dict(block=["easylist/easylist_general_block.txt", "easylist/easylist_general_block_dimensions.txt",
                                 "easylist/easylist_thirdparty.txt", "easylist/easylist_specific_block.txt",
                                 "easylist/easylist_adservers.txt",
                                 "easylist_adult/adult_adservers.txt", "easylist_adult/adult_thirdparty.txt",
                                 "easylist_adult/adult_specific_block.txt"],
                          allow=["easylist/easylist_allowlist.txt", "easylist/easylist_allowlist_dimensions.txt",
                                 "easylist_adult/adult_allowlist.txt"],
                          hide=["easylist/easylist_general_hide.txt", "easylist/easylist_specific_hide.txt",
                                "easylist/easylist_specific_hide_abp.txt", "easylist_adult/adult_specific_hide.txt"],
                          unhide=["easylist/easylist_allowlist_general_hide.txt"]),
    # EasyPrivacy's URL-level tracker rules (pixels, beacons, analytics paths).
    # Its plain domain rules are in the static rules/privacy.json already, so
    # only the rules that need a URL pattern end up here.
    "easyprivacy":   dict(block=["easyprivacy/easyprivacy_general.txt", "easyprivacy/easyprivacy_general_emailtrackers.txt",
                                 "easyprivacy/easyprivacy_specific.txt", "easyprivacy/easyprivacy_specific_abp.txt",
                                 "easyprivacy/easyprivacy_thirdparty.txt", "easyprivacy/easyprivacy_specific_international.txt",
                                 "easyprivacy/easyprivacy_thirdparty_international.txt"],
                          allow=["easyprivacy/easyprivacy_allowlist.txt", "easyprivacy/easyprivacy_allowlist_international.txt"],
                          hide=[], unhide=[]),
    "popups":        dict(block=["easylist/easylist_adservers_popup.txt", "easylist/easylist_general_block_popup.txt",
                                 "easylist/easylist_thirdparty_popup.txt", "easylist/easylist_specific_block_popup.txt",
                                 "easylist_adult/adult_adservers_popup.txt", "easylist_adult/adult_thirdparty_popup.txt",
                                 "easylist_adult/adult_specific_block_popup.txt"],
                          allow=["easylist/easylist_allowlist_popup.txt", "easylist_adult/adult_allowlist_popup.txt"], hide=[], unhide=[]),
    "cookies":       dict(block=["easylist_cookie/easylist_cookie_general_block.txt", "easylist_cookie/easylist_cookie_thirdparty.txt",
                                 "easylist_cookie/easylist_cookie_specific_block.txt",
                                 "easylist_cookie/easylist_cookie_international_specific_block.txt"],
                          allow=["easylist_cookie/easylist_cookie_allowlist.txt"],
                          hide=["easylist_cookie/easylist_cookie_general_hide.txt", "easylist_cookie/easylist_cookie_specific_hide.txt",
                                "easylist_cookie/easylist_cookie_specific_ABP.txt",
                                "easylist_cookie/easylist_cookie_international_specific_hide.txt"],
                          unhide=["easylist_cookie/easylist_cookie_allowlist_general_hide.txt"]),
    "newsletter":    dict(block=["fanboy-addon/fanboy_newsletter_general_block.txt", "fanboy-addon/fanboy_newsletter_thirdparty.txt",
                                 "fanboy-addon/fanboy_newsletter_specific_block.txt", "fanboy-addon/fanboy_newsletter_international_block.txt",
                                 "fanboy-addon/fanboy_newsletter_shopping_specific_block.txt"],
                          allow=["fanboy-addon/fanboy_newsletter_allowlist.txt"],
                          hide=["fanboy-addon/fanboy_newsletter_general_hide.txt", "fanboy-addon/fanboy_newsletter_specific_hide.txt",
                                "fanboy-addon/fanboy_newsletter_specific_ABP.txt", "fanboy-addon/fanboy_newsletter_international_hide.txt",
                                "fanboy-addon/fanboy_newsletter_shopping_specific_hide.txt"],
                          unhide=["fanboy-addon/fanboy_newsletter_allowlist_general_hide.txt"]),
    "notifications": dict(block=["fanboy-addon/fanboy_notifications_general_block.txt", "fanboy-addon/fanboy_notifications_thirdparty.txt",
                                 "fanboy-addon/fanboy_notifications_specific_block.txt"],
                          allow=["fanboy-addon/fanboy_notifications_allowlist.txt"],
                          hide=["fanboy-addon/fanboy_notifications_general_hide.txt", "fanboy-addon/fanboy_notifications_specific_hide.txt"],
                          unhide=["fanboy-addon/fanboy_notifications_allowlist_general_hide.txt"]),
    "chat":          dict(block=["fanboy-addon/fanboy_chatapps_third-party.txt"], allow=[], hide=[], unhide=[]),
    "annoyances":    dict(block=["fanboy-addon/fanboy_annoyance_general_block.txt", "fanboy-addon/fanboy_annoyance_thirdparty.txt",
                                 "fanboy-addon/fanboy_annoyance_specific_block.txt"],
                          allow=["fanboy-addon/fanboy_annoyance_allowlist.txt"],
                          hide=["fanboy-addon/fanboy_annoyance_general_hide.txt", "fanboy-addon/fanboy_annoyance_specific_hide.txt",
                                "fanboy-addon/fanboy_annoyance_international.txt"],
                          unhide=["fanboy-addon/fanboy_annoyance_allowlist_general_hide.txt"]),
    "social":        dict(block=["fanboy-addon/fanboy_social_general_block.txt", "fanboy-addon/fanboy_social_thirdparty.txt",
                                 "fanboy-addon/fanboy_social_specific_block.txt"],
                          allow=["fanboy-addon/fanboy_social_allowlist.txt"],
                          hide=["fanboy-addon/fanboy_social_general_hide.txt", "fanboy-addon/fanboy_social_specific_hide.txt",
                                "fanboy-addon/fanboy_social_international.txt"],
                          unhide=["fanboy-addon/fanboy_social_allowlist_general_hide.txt"]),
}

# The few legacy hand-written v2 ad selectors, kept so nothing regresses.
LEGACY_AD_SELECTORS = ["ins.adsbygoogle", '[id^="div-gpt-ad"]', '[id^="google_ads_iframe"]', ".ad-container",
                       ".ad-banner", ".ads-wrapper", ".advertisement", ".sponsored-content"]

TYPE_MAP = {"script": "script", "image": "image", "stylesheet": "stylesheet", "subdocument": "sub_frame",
            "xmlhttprequest": "xmlhttprequest", "media": "media", "font": "font", "object": "object",
            "ping": "ping", "websocket": "websocket", "other": "other"}
SKIP_OPTS = {"rewrite", "redirect", "redirect-rule", "csp", "removeparam", "document", "popup", "all",
             "generichide", "elemhide", "genericblock", "header", "permissions", "replace", "sitekey",
             "webrtc", "badfilter", "important"}
DOMAIN_ONLY = re.compile(r"^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^$")


def read(rel):
    p = os.path.join(SRC, rel)
    if not os.path.exists(p):
        print("  (missing, skipped)", rel)
        return []
    with open(p, encoding="utf-8", errors="replace") as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("!") and not l.startswith("[")]


def load_existing_domains():
    """Domains already blocked by the static ads/privacy/security rulesets."""
    out = {}
    for name in ("ads", "privacy", "security"):
        s = set()
        with open(os.path.join(ROOT, "rules", name + ".json")) as f:
            for r in json.load(f):
                s.update(r["condition"].get("requestDomains", []))
        out[name] = s
    return out


def covered(domain, dset):
    parts = domain.split(".")
    return any(".".join(parts[i:]) in dset for i in range(len(parts) - 1))


# ---------------------------------------------------------------------------
# Network: Adblock filter -> DNR rule body (without id / priority)
# ---------------------------------------------------------------------------
def convert_net(line, popup_ok=False):
    allow = line.startswith("@@")
    if allow:
        line = line[2:]
    pattern, opts = line, ""
    idx = line.rfind("$")
    # Options may contain ":" (e.g. rewrite=abp-resource:blank-mp4) but never "/".
    if idx >= 0 and re.fullmatch(r"[~A-Za-z0-9_=|.,*:-]+", line[idx + 1:]):
        pattern, opts = line[:idx], line[idx + 1:]
    if not pattern or pattern in ("*", "|", "||"):
        return None
    if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 2:
        return None                                       # regex rule: skipped on purpose
    if not pattern.isascii() or pattern.startswith("||*") or re.search(r"\s", pattern) or "$" in pattern:
        return None
    cond, types, extypes = {}, [], []
    for o in filter(None, opts.split(",")):
        neg = o.startswith("~")
        key = o[1:] if neg else o
        key, _, val = key.partition("=")
        if key == "popup" and popup_ok and not neg:
            types.append("main_frame")
            continue
        if key in SKIP_OPTS:
            return None
        if key == "third-party" or key == "3p":
            cond["domainType"] = "firstParty" if neg else "thirdParty"
        elif key == "first-party" or key == "1p":
            cond["domainType"] = "thirdParty" if neg else "firstParty"
        elif key == "match-case":
            cond["isUrlFilterCaseSensitive"] = True
        elif key == "domain":
            inc = [d for d in val.split("|") if d and not d.startswith("~")]
            exc = [d[1:] for d in val.split("|") if d.startswith("~")]
            if any("*" in d or not d.isascii() for d in inc + exc):
                return None
            if inc: cond["initiatorDomains"] = inc
            if exc: cond["excludedInitiatorDomains"] = exc
        elif key in TYPE_MAP:
            (extypes if neg else types).append(TYPE_MAP[key])
        else:
            return None                                   # unknown option: don't guess
    m = DOMAIN_ONLY.match(pattern)
    popup_only = types == ["main_frame"]
    simple_domain = m.group(1) if (m and set(cond) <= {"domainType"} and (not types or popup_only) and not extypes) else None
    if types: cond["resourceTypes"] = sorted(set(types))
    if extypes: cond["excludedResourceTypes"] = sorted(set(extypes))
    if not simple_domain:
        cond["urlFilter"] = pattern
    return dict(allow=allow, domain=simple_domain, cond=cond)


def build_net(existing):
    all_existing = existing["ads"] | existing["privacy"] | existing["security"]
    seen, out, stats = set(), {}, {}
    for cat, spec in CATS.items():
        packed = defaultdict(list)          # domainType -> [domains]
        rules = []
        for rel in spec["block"] + spec["allow"]:
            for line in read(rel):
                if "##" in line or "#@#" in line or "#?#" in line or "#$#" in line:
                    continue
                c = convert_net(line, popup_ok=(cat == "popups"))
                if not c:
                    continue
                key = json.dumps([c["allow"], c["domain"], c["cond"]], sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                if c["allow"]:
                    # Never let a list allow-rule re-open a malware domain.
                    tgt = c["domain"] or (DOMAIN_ONLY.match(c["cond"].get("urlFilter", "").split("/")[0] + "^") or [None, None])[1]
                    if tgt and covered(tgt, existing["security"]):
                        continue
                    rules.append({"priority": 2, "action": {"type": "allow"}, "condition": c["cond"] if not c["domain"] else {**c["cond"], "requestDomains": [c["domain"]]}})
                elif c["domain"]:
                    # (pop-under domains are kept even if statically blocked: static
                    # rules never apply to main_frame, so a pop-under tab would load)
                    if cat != "popups" and covered(c["domain"], all_existing):
                        continue                  # static rulesets already block it
                    packed[c["cond"].get("domainType", "any")].append(c["domain"])
                else:
                    cond = c["cond"]
                    if cat == "popups" and "resourceTypes" not in cond:
                        cond["resourceTypes"] = ["main_frame", "sub_frame"]
                    rules.append({"priority": 1, "action": {"type": "block"}, "condition": cond})
        for dt, doms in packed.items():
            doms = sorted(set(doms))
            for i in range(0, len(doms), 1000):
                cond = {"requestDomains": doms[i:i + 1000]}
                if dt != "any":
                    cond["domainType"] = dt
                if cat == "popups":
                    cond["resourceTypes"] = ["main_frame", "sub_frame"]
                rules.append({"priority": 1, "action": {"type": "block"}, "condition": cond})
        out[cat] = rules
        stats[cat] = len(rules)
    for cat, doms in CURATED_EXTRA.items():
        add = sorted(d for d in doms if not covered(d, all_existing))
        if add:
            out[cat] = out.get(cat, []) + [{"priority": 1, "action": {"type": "block"},
                                            "condition": {"requestDomains": add, "domainType": "thirdParty"}}]
            stats[cat] = f"{stats.get(cat)} + {len(add)} curated"
    # "pgl" slot (kept for stable rule ids): now only the project-curated
    # third-party ad/analytics endpoints. Peter Lowe's list was dropped because
    # it publishes no licence for redistribution.
    cur = sorted(d for d in CURATED_THIRD_PARTY if not covered(d, all_existing))
    out["pgl"] = [{"priority": 1, "action": {"type": "block"},
                   "condition": {"requestDomains": cur, "domainType": "thirdParty"}}] if cur else []
    stats["pgl"] = f"{len(out['pgl'])} rules / {len(cur)} curated domains"
    # Opt-in: hand-curated phone / OS maker telemetry domains.
    tel = set(CURATED_TELEMETRY)
    tel = sorted(d for d in tel if not covered(d, all_existing))
    out["telemetry"] = [{"priority": 1, "action": {"type": "block"}, "condition": {"requestDomains": tel[i:i + 1000]}}
                        for i in range(0, len(tel), 1000)]
    stats["telemetry"] = f"{len(out['telemetry'])} rules / {len(tel)} domains"
    return out, stats


# ---------------------------------------------------------------------------
# Cosmetic: index selectors by a class/id token that must exist for them to match
# ---------------------------------------------------------------------------
SIMPLE = re.compile(r"^([.#])([A-Za-z_][\w-]*)$")
TOKEN = re.compile(r"([.#])(-?[A-Za-z_][\w-]*)")


def strip_not(sel):
    """Remove :not(...) groups (tokens inside them need NOT exist)."""
    out, depth, i = [], 0, 0
    while i < len(sel):
        if sel.startswith(":not(", i) and depth == 0:
            depth, i = 1, i + 5
            continue
        if depth:
            depth += {"(": 1, ")": -1}.get(sel[i], 0)
            i += 1
            continue
        out.append(sel[i]); i += 1
    return "".join(out)


def key_for(sel):
    m = SIMPLE.match(sel)
    if m:
        return ("i:" if m.group(1) == "#" else "c:") + m.group(2)
    s = re.sub(r"\[[^\]]*\]", "", strip_not(sel))          # attribute values can contain dots
    s = re.sub(r'"[^"]*"|\'[^\']*\'', "", s)
    toks = TOKEN.findall(s)
    if not toks:
        return None                                       # "lowly generic": always injected
    kind, name = toks[0]
    return ("i:" if kind == "#" else "c:") + name


UNSUPPORTED_FILTER_OPERATORS = ("+js(", ":matches-path(", ":others(", ":min-text-length(", ":matches-attr(", ":matches-prop(",
                                ":if(", ":if-not(", ":spath(", ":shadow(", ":watch-attrs(", ":matches-media(")

PROCEDURAL = re.compile(r":(has-text|-abp-contains|upward)\(")


def smuggles_css(sel):
    """True if a selector carries CSS of its own: a brace or ';' outside quoted
    text, a comment, or an at-rule. The extension turns each selector into
    `<selector>{display:none!important}`, so a list entry like
    `x{background:url(//host/)` would add declarations, not just hide things.
    (';' inside quotes is normal: div[style*="color: red;"].)"""
    if sel.lstrip().startswith("@") or "/*" in sel:
        return True
    quote, i = None, 0
    while i < len(sel):
        c = sel[i]
        if c == "\\":
            i += 2
            continue
        if quote:
            if c == quote:
                quote = None
        elif c in "\"'":
            quote = c
        elif c in "{};":
            return True
        i += 1
    return quote is not None                               # an unclosed quote swallows what follows


def norm_selector(sel, extended):
    if smuggles_css(sel):
        return None                                        # only ever hide: never pass list-supplied CSS through
    if sel.startswith("^") or any(t in sel for t in UNSUPPORTED_FILTER_OPERATORS):
        return None                                        # features not implemented by this selector engine
    if ":-abp-properties" in sel or ":xpath" in sel or ":style" in sel or ":remove" in sel \
            or ":matches-" in sel or ":watch-attr" in sel:
        return None
    # :has-text / :-abp-contains / :upward run in src/procedural.js, which can't
    # evaluate them inside :not(...) or after a sibling combinator.
    if PROCEDURAL.search(sel) and (re.search(r":not\([^)]*:(has-text|-abp-contains|upward)\(", sel) or re.search(r"[+~]", sel)):
        return None
    sel = sel.replace(":-abp-has(", ":has(")
    return sel.strip() or None


# Token and site entries are stored as one string each ("cat\x1fselector" joined by
# \x1e) instead of many small arrays: the extension keeps this file in memory,
# and plain strings take a fraction of the space. See pairs() in src/background.js.
def packed(entries):
    return "\x1e".join(f"{ci}\x1f{sel}" for ci, sel in entries)


def build_cosmetic():
    cats = list(CATS.keys())
    token_map = defaultdict(list)           # token -> [[catIdx, selector]]
    lowly = defaultdict(list)               # catIdx -> [selector]
    specific = defaultdict(list)            # domain -> [[catIdx, selector]]
    exceptions = defaultdict(set)           # domain -> {selector}
    generic_off = set()                     # domains with $generichide/$elemhide
    seen = set()
    for ci, cat in enumerate(cats):
        spec = CATS[cat]
        lines = []
        for rel in spec["hide"] + spec["unhide"]:
            lines += read(rel)
        if cat == "ads":
            lines += ["##" + s for s in LEGACY_AD_SELECTORS]
        for rel in spec["allow"]:
            for line in read(rel):
                m = re.match(r"^@@\|\|([a-z0-9.-]+)\^\$(?:.*,)?(generichide|elemhide)", line)
                if m:
                    generic_off.add(m.group(1))
        for line in lines:
            for sep in ("#@#", "#?#", "##"):
                if sep in line:
                    doms, sel = line.split(sep, 1)
                    break
            else:
                continue
            sel = norm_selector(sel, sep == "#?#")
            if not sel:
                continue
            domains = [d for d in doms.split(",") if d and not d.startswith("~")] if doms else []
            if PROCEDURAL.search(sel) and not domains:
                continue                                   # text-matching rules only where a site is named
            if sep == "#@#":
                for d in domains:
                    exceptions[d].add(sel)
                continue
            if domains:
                for d in domains:
                    k = (d, sel)
                    if k not in seen:
                        seen.add(k); specific[d].append([ci, sel])
            elif not doms:
                if ("*", sel) in seen:
                    continue
                seen.add(("*", sel))
                k = key_for(sel)
                (token_map[k] if k else lowly[ci]).append([ci, sel] if k else sel)
    return dict(
        cats=cats,
        tokens={k: packed(v) for k, v in token_map.items()},
        lowly={cats[i]: v for i, v in lowly.items()},
        specific={k: packed(v) for k, v in specific.items()},
        exceptions={d: sorted(s) for d, s in exceptions.items()},
        genericOff=sorted(generic_off),
    )


def main():
    if not os.path.isdir(SRC):
        sys.exit("EasyList checkout not found at " + SRC)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    existing = load_existing_domains()
    net, stats = build_net(existing)
    # Each category owns 10,000 dynamic rule ids in src/background.js (LIST_BLOCK).
    too_big = {c: len(r) for c, r in net.items() if len(r) >= 10000}
    if too_big:
        sys.exit(f"Category too large for its 10,000 rule-id block: {too_big}. Raise LIST_BLOCK or split the category.")
    with open(os.path.join(ROOT, "data", "netrules.json"), "w") as f:
        json.dump(net, f, separators=(",", ":"))
    cos = build_cosmetic()
    with open(os.path.join(ROOT, "data", "cosmetic.json"), "w") as f:
        json.dump(cos, f, separators=(",", ":"))
    print("network rules per category:", stats)
    print("cosmetic: tokens", len(cos["tokens"]), "lowly", {k: len(v) for k, v in cos["lowly"].items()},
          "specific domains", len(cos["specific"]), "exception domains", len(cos["exceptions"]),
          "genericOff", len(cos["genericOff"]))


if __name__ == "__main__":
    main()
