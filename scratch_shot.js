const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://localhost:3000/home', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'scratch_home_top2.png' });
  await browser.close();
})();
