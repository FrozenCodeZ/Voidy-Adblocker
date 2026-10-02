// Look-alike site check, done entirely on this computer (no address is sent
// anywhere). Compares the site you open with a short list of often-copied
// brands:
//   "strong": disguised letters (Cyrillic "а" for "a", "0" for "o", "rn" for "m")
//             -> Voidy shows its warning page before the site loads
//   "weak":   one letter off ("paypall") or the brand inside another address
//             ("paypal-login-secure.com") -> warn only if the page asks for a password
//   VOIDY_LOOKALIKE.check("xn--pypal-4ve.com") -> { brand: "paypal.com", strength: "strong", why }
globalThis.VOIDY_LOOKALIKE = (() => {
  // ---- Settings ------------------------------------------------------------
  // Often-impersonated sites: the first name is shown in the warning; the rest
  // are the same company's other real addresses.
  const BRANDS = [
    ["paypal.com", "paypal.me", "paypalobjects.com"], ["google.com", "gmail.com", "youtube.com", "googleusercontent.com", "goo.gl", "googl.com"],
    ["apple.com", "icloud.com"], ["microsoft.com", "live.com", "outlook.com", "office.com", "microsoftonline.com", "xbox.com", "xboxservices.com", "xboxlive.com"],
    ["amazon.com", "amazonaws.com", "a2z.com", "payments-amazon.com", "amazonpay.com"], ["ebay.com"], ["facebook.com", "fb.com", "messenger.com"], ["instagram.com"],
    ["whatsapp.com"], ["netflix.com"], ["spotify.com"], ["steampowered.com", "steamcommunity.com"], ["discord.com", "discord.gg"],
    ["roblox.com"], ["epicgames.com"], ["binance.com"], ["coinbase.com"], ["kraken.com"], ["metamask.io"], ["blockchain.com"],
    ["chase.com"], ["bankofamerica.com"], ["wellsfargo.com"], ["citibank.com", "citi.com"], ["hsbc.com"], ["barclays.co.uk"],
    ["santander.com"], ["americanexpress.com"], ["capitalone.com"], ["usps.com"], ["fedex.com"], ["dhl.com"],
    ["github.com"], ["dropbox.com"], ["linkedin.com"], ["twitter.com", "x.com"], ["tiktok.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu", "tiktokw.us", "tiktokw.eu", "tiktokcdn.com"], ["yahoo.com"], ["adobe.com", "adobelogin.com"],
    ["zoom.us"], ["walmart.com", "wal-mart.com"], ["target.com"], ["bestbuy.com"], ["aliexpress.com"], ["booking.com"], ["airbnb.com"],
    ["docusign.com", "docusign.net"], ["wetransfer.com"], ["office365.com"], ["onedrive.com"], ["telegram.org", "telegra.ph", "t.me"], ["reddit.com"],
    ["twitch.tv"], ["playstation.com"], ["nintendo.com"], ["battle.net", "blizzard.com"], ["revolut.com"], ["wise.com"],
    ["venmo.com"], ["cash.app"], ["stripe.com"], ["shopify.com"], ["etsy.com"], ["intuit.com"], ["irs.gov"],
  ];
  // Words scam addresses glue to a brand name ("paypal-secure-login.com").
  const LURES = /(^|-)(login|log-in|signin|sign-in|secure|security|verify|verification|account|accounts|support|update|billing|wallet|recover|recovery|unlock|confirm|auth|service|help|payment|refund|gift|claim|reward)s?(-|$)/;
  const MIN_TYPO_LENGTH = 6;          // "one letter off" only for names this long (shorter ones collide with real words)
  // Brand names one letter away from everyday words (finance, strip, twitchy): no "one letter off" check.
  const NO_TYPO = new Set(["stripe", "target", "twitch", "binance", "battle", "github", "booking", "revolut", "intuit", "reddit", "office"]);
  // Real, unrelated sites whose names happen to sit close to a brand.
  const KNOWN_OK = ["paypay.ne.jp", "blockchair.com", "citicbank.com", "wmtransfer.com", "telegraf.rs", "telegraf.com.ua", "kingsoft-office-service.com"];
  // --------------------------------------------------------------------------

  const legit = new Set([...BRANDS.flat(), ...KNOWN_OK]);
  const brandLabels = new Map();
  for (const group of BRANDS) for (const d of group) { const l = d.split(".")[0]; if (l.length >= 4 && !brandLabels.has(l)) brandLabels.set(l, group[0]); }
  // "shop.example.co.uk" -> "example.co.uk": country endings like com.pe, co.jp, org.uk
  const SECOND = /^(com|co|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc|web|biz|info|nom)$/;
  function registrable(host) {
    const p = host.split(".");
    return p.slice(p.length > 2 && p[p.length - 1].length === 2 && SECOND.test(p[p.length - 2]) ? -3 : -2).join(".");
  }

  // Punycode (RFC 3492) decoding for "xn--" labels.
  function punyDecode(label) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const input = label.slice(4), out = [];
    let i = 0, n = 128, bias = 72, basic = input.lastIndexOf("-");
    if (basic > 0) for (const c of input.slice(0, basic)) out.push(c.charCodeAt(0));
    const adapt = (delta, points, first) => {
      delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / points); let k = 0;
      while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
      return k + Math.floor((base - tMin + 1) * delta / (delta + skew));
    };
    for (let pos = basic > 0 ? basic + 1 : 0; pos < input.length;) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        if (pos >= input.length) return label;
        const c = input.charCodeAt(pos++);
        const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
        if (digit >= base) return label;
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        w *= base - t;
      }
      bias = adapt(i - oldi, out.length + 1, oldi === 0);
      n += Math.floor(i / (out.length + 1)); i %= out.length + 1;
      out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  }

  // Letters that look like Latin ones, and the swaps scammers use.
  const GLYPHS = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ԁ": "d", "һ": "h",
    "ӏ": "l", "ѕ": "s", "ԛ": "q", "ԝ": "w", "ɡ": "g", "ο": "o", "α": "a", "ν": "v", "τ": "t", "ι": "i", "κ": "k", "ρ": "p",
    "à": "a", "á": "a", "â": "a", "ä": "a", "å": "a", "ã": "a", "è": "e", "é": "e", "ê": "e", "ë": "e", "ì": "i", "í": "i", "î": "i",
    "ï": "i", "ò": "o", "ó": "o", "ô": "o", "ö": "o", "õ": "o", "ù": "u", "ú": "u", "û": "u", "ü": "u", "ç": "c", "ñ": "n", "ý": "y",
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s" };
  const skeleton = (s) => [...s].map((c) => GLYPHS[c] || c).join("").replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d");

  // Damerau-Levenshtein distance, capped (we only care about 0, 1 or "more").
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
  }

  function check(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
    const reg = registrable(host);
    if (legit.has(reg)) return null;
    const rawLabel = reg.split(".")[0];
    if (brandLabels.has(rawLabel)) return null;                 // the real brand in another country (amazon.de)
    const label = rawLabel.startsWith("xn--") ? punyDecode(rawLabel) : rawLabel;
    const skel = skeleton(label);
    // strong: made to look identical
    if (skel !== label && brandLabels.has(skel)) return { brand: brandLabels.get(skel), strength: "strong", why: "uses look-alike letters" };
    // a disguised brand followed or preceded by another word ("app1e-id" -> "apple" + "id")
    if (skel !== label) for (const part of label.split("-")) {
      const sk = skeleton(part);
      if (sk !== part && brandLabels.has(sk)) return { brand: brandLabels.get(sk), strength: "strong", why: "uses look-alike letters" };   // the brand part itself is disguised
    }
    for (const [b, brand] of brandLabels) {
      // weak: one letter off
      if (b.length >= MIN_TYPO_LENGTH && !NO_TYPO.has(b) && distance(skel, b) === 1) return { brand, strength: "weak", why: "is one letter off" };
      // weak: brand name glued to a scam word, or used as a fake sub-address on another site
      const parts = host.slice(0, -reg.length - 1).split(".").concat(skel);
      if (parts.some((p) => p === b || (p.includes(b) && LURES.test(p.replace(b, ""))))) return { brand, strength: "weak", why: "borrows the name in a different address" };
    }
    return null;
  }
  return { check, punyDecode, skeleton, BRANDS };
})();
