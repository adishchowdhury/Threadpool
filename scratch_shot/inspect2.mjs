import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const h1 = document.querySelector('h1');
  const cs = getComputedStyle(h1);
  const span = h1.querySelector('span');
  const csSpan = span ? getComputedStyle(span) : null;
  return {
    opacity: cs.opacity, color: cs.color, transform: cs.transform, zIndex: cs.zIndex, display: cs.display, visibility: cs.visibility,
    spanColor: csSpan ? csSpan.color : null, spanOpacity: csSpan ? csSpan.opacity : null, spanMixBlend: csSpan ? csSpan.mixBlendMode : null,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
