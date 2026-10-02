# Security policy

## Supported versions

Only the latest version of Voidy gets security fixes. Chrome updates
extensions automatically, so most people already have it.

| Version | Security fixes |
|---|---|
| 1.0.x (latest) | Yes |
| Older | No, please update |

## Reporting a vulnerability

Please report security problems privately, not in a public issue, so they can
be fixed before anyone else learns about them.

1. Open the [Security tab](https://github.com/FrozenCodeZ/Voidy-Adblocker/security)
   of this repository.
2. Click **Report a vulnerability** and describe the problem.

Useful details: what a web page or another extension can do, the steps to
reproduce it, the Voidy version (shown under the Voidy name on the settings page) and
your Chrome version.

Voidy is made by one person, so a reply can take a few days. You'll hear
whether the report is accepted. If it is, the fix ships in a new version, and
you'll be credited in the release notes unless you'd rather not be.

## What counts

Report it here if a web page or another extension can:

- read or change Voidy's settings, or switch its protection off for a site
- get past the redirect guard, the dangerous-site warning or the look-alike
  warning
- learn something about you through Voidy that it couldn't learn otherwise
- run its own code inside Voidy's pages (the popup, settings or warning pages)

Ordinary blocking problems are not security issues. An ad that gets through,
a site that breaks, or a block list that blocks the wrong address goes in a
[normal issue](https://github.com/FrozenCodeZ/Voidy-Adblocker/issues), or use
*Report a problem* in the popup.
