import { chromium } from "playwright";
import fs from "fs";

const shotDir = "scripts/.screenshots";
fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForSelector("text=Momentum").catch(() => {});

await page.click('button[aria-label="Run task"]');
console.log("Clicked send button");

try {
  await page.waitForSelector("text=Final Report", { timeout: 120000 });
  console.log("Task completed — Final Report visible");
} catch {
  console.log("Task did not complete within 120s — capturing state anyway");
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${shotDir}/mobile-06-final-report.png`, fullPage: false });

const closeBtn = page.locator('[data-slot="dialog-close"]');
console.log("Close button count:", await closeBtn.count());
console.log("Close button visible:", await closeBtn.first().isVisible().catch(() => false));
const box = await closeBtn.first().boundingBox().catch(() => null);
console.log("Close button box:", JSON.stringify(box));

await browser.close();
