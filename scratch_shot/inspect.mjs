import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const main = document.querySelector('main');
  const row = main ? main.children[1] : null;
  return {
    h1text: h1 ? h1.textContent : null,
    h1style: h1 ? getComputedStyle(h1).cssText.slice(0,300) : null,
    h1rect: h1 ? h1.getBoundingClientRect() : null,
    mainRect: main ? main.getBoundingClientRect() : null,
    rowClass: row ? row.className : null,
    rowRect: row ? row.getBoundingClientRect() : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
