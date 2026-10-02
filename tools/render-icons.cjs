// Render a bold mark at toolbar sizes; use the detailed painted art at larger sizes.
// Run: node tools/render-icons.cjs   (needs `npm install` for Playwright, and Chrome installed)
const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const dir = path.join(__dirname, '..', 'icons');
const chrome = process.env.VOIDY_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  const browser = await playwright.chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome } : {});
  const detailed = fs.readFileSync(path.join(dir, 'voidy.svg'), 'utf8');
  const small = fs.readFileSync(path.join(dir, 'voidy-small.svg'), 'utf8');
  for (const n of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: n, height: n } });
    const svg = n <= 32 ? small : detailed;
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${n}px;height:${n}px}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, `icon${n}.png`), omitBackground: true });
    await page.close();
    console.log('wrote icons/icon' + n + '.png');
  }
  await browser.close();
})();
