// Registrable-domain helper (a Public Suffix List subset), shared by extension
// pages. guard-main.js keeps its own copy of SUFFIXES because MAIN-world scripts
// can't load extension files. Keep the two lists identical.
//
// Besides country suffixes ("co.uk"), the list holds shared hosting platforms
// ("github.io", "netlify.app"), where every customer gets their own subdomain:
// "a.github.io" and "b.github.io" are different sites, not one. IP addresses
// are returned whole ("192.168.1.10", never "1.10").
(function (g) {
  const SUFFIXES = new Set([
    // country second levels
    "co.uk","org.uk","gov.uk","ac.uk","me.uk","ltd.uk","plc.uk","net.uk","sch.uk","nhs.uk","police.uk",
    "co.jp","ne.jp","or.jp","go.jp","ac.jp","ad.jp","ed.jp","gr.jp","lg.jp",
    "com.au","net.au","org.au","gov.au","edu.au","id.au","asn.au",
    "co.nz","net.nz","org.nz","govt.nz","ac.nz","school.nz",
    "com.br","net.br","org.br","gov.br","edu.br",
    "com.cn","net.cn","org.cn","gov.cn","edu.cn","ac.cn",
    "com.mx","org.mx","gob.mx","edu.mx",
    "com.tr","org.tr","gov.tr","edu.tr","net.tr",
    "com.sg","edu.sg","gov.sg","org.sg","net.sg",
    "com.hk","org.hk","gov.hk","edu.hk","net.hk",
    "com.tw","org.tw","gov.tw","edu.tw","net.tw",
    "co.in","net.in","org.in","gov.in","ac.in","edu.in","firm.in","gen.in","ind.in",
    "co.kr","or.kr","go.kr","ac.kr","ne.kr",
    "co.za","org.za","gov.za","ac.za","net.za",
    "com.ar","org.ar","gob.ar","net.ar",
    "com.sa","org.sa","gov.sa","edu.sa",
    "com.eg","org.eg","gov.eg","edu.eg",
    "com.ua","org.ua","gov.ua","net.ua","in.ua",
    "co.il","org.il","gov.il","ac.il",
    "com.my","org.my","gov.my","edu.my",
    "co.id","or.id","go.id","ac.id","web.id",
    "com.ph","org.ph","gov.ph","edu.ph",
    "com.vn","org.vn","gov.vn","edu.vn","net.vn",
    "co.th","or.th","go.th","ac.th","in.th",
    "com.pk","org.pk","gov.pk","edu.pk",
    "com.ng","org.ng","gov.ng","edu.ng",
    "com.co","org.co","gov.co","edu.co",
    "com.pe","gob.pe","com.ve","com.ec","com.uy","com.py","com.bo","com.do","com.gt","com.sv","com.pa",
    "co.ke","or.ke","go.ke","co.tz","co.ug","co.zw","com.gh","com.np","com.bd","com.lk",
    "com.kw","com.qa","com.om","com.bh","com.lb","com.jo","com.cy","com.mt","com.gr",
    "co.at","or.at","gv.at","ac.at","com.pl","net.pl","org.pl","gov.pl","edu.pl",
    "com.ru","org.ru","net.ru","com.es","org.es","gob.es","nom.es","com.pt","org.pt","gov.pt",
    "co.hu","com.ro","org.ro","com.hr","co.rs","com.by","com.kz","org.kz","com.az","com.ge",
    // shared hosting: each customer subdomain is its own site
    "github.io","gitlab.io","githubusercontent.com","github.dev","bitbucket.io","blogspot.com","wordpress.com",
    "tumblr.com","weebly.com","weeblysite.com","wixsite.com","squarespace.com","myshopify.com","godaddysites.com",
    "jimdosite.com","mystrikingly.com","webflow.io","framer.website","carrd.co","notion.site","gitbook.io",
    "readthedocs.io","neocities.org","000webhostapp.com","surge.sh",
    "pages.dev","workers.dev","r2.dev","trycloudflare.com","netlify.app","vercel.app","now.sh","web.app",
    "firebaseapp.com","appspot.com","herokuapp.com","azurewebsites.net","azurestaticapps.net","azureedge.net",
    "cloudapp.net","cloudfront.net","s3.amazonaws.com","elasticbeanstalk.com","amplifyapp.com","onrender.com",
    "fly.dev","deno.dev","glitch.me","repl.co","replit.app","replit.dev","codesandbox.io","stackblitz.io",
    "pythonanywhere.com","ngrok.io","ngrok.app","ngrok-free.app","loca.lt","googleusercontent.com","translate.goog",
    "duckdns.org","no-ip.org","ddns.net","hopto.org","zapto.org","sytes.net","dynu.net","freemyip.com","dyndns.org"
  ]);
  const isIP = (h) => h.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  function registrable(hostname) {
    const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!h || isIP(h)) return h;
    const p = h.split(".");
    // the longest listed suffix wins ("s3.amazonaws.com" before "amazonaws.com")
    for (let k = Math.min(p.length - 1, 3); k >= 2; k--)
      if (SUFFIXES.has(p.slice(-k).join("."))) return p.slice(-(k + 1)).join(".");
    return p.length <= 2 ? h : p.slice(-2).join(".");
  }
  g.VOIDY_PSL = { registrable, SUFFIXES };
})(typeof self !== "undefined" ? self : this);
