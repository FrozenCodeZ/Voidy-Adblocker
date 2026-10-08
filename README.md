# Voidy

A free ad blocker for Chrome with a mascot: Voidy, a small black hole that eats
ads, trackers, pop-ups and dangerous sites. Every feature is free, and there is
no account.

## What it does

- Blocks ads and trackers with public block lists (EasyList, EasyPrivacy,
  HaGeZi and URLhaus). The lists update themselves.
- Starts YouTube videos without ads, skips the ad breaks Twitch stitches into
  streams by switching to an ad-free copy of the same stream, and hides
  Reddit's promoted posts.
- Removes sponsored posts from X, Instagram and Facebook feeds. These sites
  mark each ad in the data behind the feed, and Voidy drops the marked posts
  before the page shows them. Posts labelled "Sponsored" or "Promoted" that
  get through are hidden. These sites change often, so an ad can still slip
  through.
- Warns you before a dangerous site loads (malware, phishing, scams, fake
  shops). You can still continue if you're sure.
- Warns you about look-alike sites such as "paypa1.com" or "g00gle.com" before
  you type a password. The check runs on your computer.
- Hides leftover ad boxes, cookie banners, newsletter pop-ups and similar
  clutter.
- Lets you hide any ad yourself: right-click it and choose *Hide this with
  Voidy*, or click *Hide an ad on this page* in the popup and point at it.
  It stays hidden on that site.
- Holds redirects and pop-ups a page opens on its own until you say yes.
- Sends the Global Privacy Control signal, which asks sites not to sell or
  share your data. It is on by default and not sent on sites you set to Off.
- Offers optional fingerprinting and WebRTC protection, for one site or for
  every site.
- Lets you block other sites' scripts, embeds and live connections, or all
  JavaScript, on any site you choose.
- Offers Stealth modes for sites that refuse to work with an ad blocker. No
  blocker can promise to be undetectable, but they help on many sites.
- When a site looks broken, *Fix this site* in the popup asks a few Yes/No
  questions while it tests what Voidy blocked there, then allows only the one
  thing the site needs. *Or just ease off here* turns protection down on that
  site in one click. *Report a problem* copies a short report with site names
  only, for the feedback form.
- Fetches small site fixes from this repository a few times a day (plain data,
  never code), so a broken site or a new ad trick can be fixed without waiting
  for a store update. You can switch them off under Sites.

## Modes (per site, in the popup)

| Mode | What it does |
|---|---|
| Auto | Starts at Full and adds stealth only if a site fights back |
| Full | Blocks ads and trackers, hides ad boxes, holds surprise redirects |
| Lite | Blocks ads only, the gentlest mode for fragile sites |
| Off | Voidy does nothing on this site |
| Stealth 1 to 3 | Disguises the blocking more and more, for sites with an ad-block wall |

## Install from source

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick this folder.

## Build the lists yourself (optional)

The rule files in `rules/` and `data/` are generated. With
[EasyList](https://github.com/easylist/easylist) checked out at
`../easylist-source` and the HaGeZi files named in `data/list-sources.json`
saved in `../list-sources/hagezi`:

```
python tools/refresh_lists.py        # downloads every list, then rebuilds the rule files
```

(or, with the sources already in place, `python tools/build_static_rules.py` and
`python tools/build_lists.py`).

## Privacy

Voidy doesn't collect or send any personal data. See [PRIVACY.md](PRIVACY.md).

## Support

Found a bug or a site Voidy breaks? Open an issue at
https://github.com/FrozenCodeZ/Voidy-Adblocker/issues, or use *Report a problem*
in the popup.

Voidy is free. If you like it, you can
[buy me a coffee](https://buymeacoffee.com/FrozenCodeZ).

## License

GPL-3.0, see [LICENSE](LICENSE). Block lists and other third-party material
are credited in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). The name
"Voidy" and the Voidy mascot and logo are not covered by the license and may not
be used for copies or forks.
