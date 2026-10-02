# Voidy privacy policy

Last updated: 1 October 2026

Voidy doesn't collect, sell or share personal data. It has no account, no
analytics and no servers of its own.

## What stays on your computer

Your settings, per-site choices, elements you hid, blocked-item counts and the
optional YouTube startup timings are stored in your browser only. Uninstalling
Voidy removes them.

Checks for dangerous and look-alike sites also run on your computer. The
addresses you visit are never sent anywhere to be checked.

## Connections Voidy makes

- **Block list updates** (can be turned off in Settings → Filter lists):
  Voidy downloads public block lists from easylist.to,
  easylist-downloads.adblockplus.org, cdn.jsdelivr.net,
  raw.githubusercontent.com, curbengh.github.io or malware-filter.gitlab.io. These are plain file downloads. Voidy sends nothing
  about you or your browsing with them, but like any download, those sites can
  see your IP address.
- **YouTube settings:** a few times a day Voidy checks Voidy's own public GitHub
  repository (github.com/FrozenCodeZ/Voidy-Adblocker, via raw.githubusercontent.com
  or cdn.jsdelivr.net) for a small file of YouTube settings, so YouTube fixes
  arrive without waiting for a store update. It contains plain values, never code.
- **Buttons you click:** "Buy me a coffee" opens buymeacoffee.com, and "Send
  feedback" opens a Google Form. "Report a problem with this site" copies a
  short report to your clipboard (the site's name, Voidy's mode, and the names
  of sites blocked on that page, never full addresses or page content) and opens
  the same form. Nothing is sent unless you paste it and submit the form yourself.

## What Voidy tells websites

By default Voidy sends the standard Global Privacy Control signal, a request not
to sell or share your data. It is an HTTP header (`Sec-GPC: 1`) on your requests
and a browser flag (`navigator.globalPrivacyControl`) in pages. Voidy sends
nothing else about you. You can switch it off in Settings → Advanced privacy; it
is not sent on sites you have set to Off.

## Permissions

Voidy reads and changes web pages so that it can block ads, hide ad boxes and
guard against surprise redirects. It does this on your computer and never sends
page contents anywhere. It also notes which requests it blocked, so it can show
you counts and the names of blocked sites; only site names are kept, on your
computer, never full addresses. The optional "privacy" permission is only asked for if
you turn on one of the browser privacy switches: WebRTC IP protection, no
preloading, or blocking third-party cookies.

## Changes to this policy

If what Voidy does with data ever changes, this page is updated first, with a
new date at the top.

## Contact

Questions about privacy: open an issue at
https://github.com/FrozenCodeZ/Voidy-Adblocker/issues.
