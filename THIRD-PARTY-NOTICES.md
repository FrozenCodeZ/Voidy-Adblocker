# Third-party notices

Voidy's own code is licensed GPL-3.0 (see `LICENSE`). It uses the block lists
below. Thank you to their authors and contributors.

## Block lists

| List | Used for | License |
|---|---|---|
| [EasyList](https://easylist.to/) (with EasyList Adult, EasyList Cookie and the Fanboy lists) | Ad servers, ad addresses, element hiding, cookie banners and annoyances | GPL-3.0-or-later (one of the two licenses EasyList offers; Voidy uses this one) |
| [EasyPrivacy](https://easylist.to/) | Trackers | GPL-3.0-or-later (as above) |
| [HaGeZi DNS blocklists](https://github.com/hagezi/dns-blocklists): Multi PRO, Pop-Up Ads, Threat Intelligence Feeds (mini and IPs), Fake | Trackers, pop-up ads, malicious sites | GPL-3.0 |
| [URLhaus](https://urlhaus.abuse.ch/) by abuse.ch, through the [malware-filter](https://gitlab.com/malware-filter/urlhaus-filter) project's domain list | Malware-distribution sites | CC0 1.0 (URLhaus data); CC0 / MIT (malware-filter) |

- EasyList source and license: https://github.com/easylist/easylist,
  https://easylist.to/pages/licence.html
- HaGeZi source and license: https://github.com/hagezi/dns-blocklists,
  https://github.com/hagezi/dns-blocklists/blob/main/LICENSE
- URLhaus: https://urlhaus.abuse.ch/ (the malware-filter project is not endorsed by
  abuse.ch); malware-filter: https://gitlab.com/malware-filter/urlhaus-filter

The files built from these lists are `rules/ads.json`, `rules/privacy.json`,
`rules/security.json`, `data/netrules.json` and `data/cosmetic.json`
(see `tools/`). When automatic updates are on, Voidy downloads newer copies of
the same lists (addresses only) from the list authors' own sites and mirrors:
easylist.to, easylist-downloads.adblockplus.org, cdn.jsdelivr.net,
raw.githubusercontent.com, curbengh.github.io and malware-filter.gitlab.io.

## Ideas learned from uBlock Origin

Voidy's YouTube handling (`src/yt-main.js`) was written for Voidy after studying
how [uBlock Origin](https://github.com/gorhill/uBlock) and
[uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home) handle YouTube,
through their public filter lists in
[uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets) (GPL-3.0).
In particular, the idea of sending player requests with a fresh activity time and
a player-params value comes from those filters. No uBlock Origin code or filter
files are included in Voidy. Thank you to Raymond Hill and the uBlock Origin
volunteers.

## Website

The website in `docs/` uses the Bricolage Grotesque typeface by the Bricolage
Grotesque Project Authors, under the SIL Open Font License 1.1 (see
`docs/fonts/OFL.txt`). It is hosted with the site; visitors' browsers do not
contact a font service.

## Voidy's own material

- A short list of well-known ad and tracking addresses, the domains that are
  never blocked (`data/list-sources.json`), and a few extra rules in
  `data/supplemental.json` and `tools/build_lists.py` are written for Voidy.
- The replacement scripts in `surrogates/`, the stealth, YouTube and privacy
  code, and the element-hiding engine are written for Voidy.
- Voidy's artwork, icons and animations were made for this project and contain
  no third-party images.
