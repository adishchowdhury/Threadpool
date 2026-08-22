import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

for (const y of [900, 1800, 2700]) {
  await page.evaluate((py) => window.scrollTo(0, py), y);
  await page.waitForTimeout(900);
}

await page.screenshot({
  path: "C:/Users/AYANTI~1/AppData/Local/Temp/claude/e--project-innofusion3-0/ec87036d-52c6-4f63-b48b-eefae4f7393a/scratchpad/full2.png",
  fullPage: true,
});
await browser.close();
