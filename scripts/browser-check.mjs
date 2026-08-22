import { chromium } from "playwright";
import fs from "fs";

const shotDir = "scripts/.screenshots";
fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));
page.on("response", (res) => {
  if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForSelector("text=Momentum");
await page.screenshot({ path: `${shotDir}/01-loaded.png`, fullPage: true });
console.log("Loaded dashboard. Agent registry visible:", await page.locator("text=Agent Registry").isVisible());

await page.click('button:has-text("Run Task")');
console.log("Clicked Run Task");

// Wait for task to progress: workflow subtasks should appear
await page.waitForSelector("text=market_research", { timeout: 20000 }).catch(() => console.log("market_research subtask card did not appear in time"));
await page.screenshot({ path: `${shotDir}/02-running.png`, fullPage: true });

// Wait for completion (Final Report) or failure, up to 60s
try {
  await page.waitForSelector("text=Final Report", { timeout: 120000 });
  console.log("Task completed — Final Report visible");
} catch {
  console.log("Task did not complete within 60s — capturing state anyway");
}
await page.screenshot({ path: `${shotDir}/03-final.png`, fullPage: true });

const remainingText = await page.locator("text=Remaining").first().isVisible().catch(() => false);
console.log("Economy panel 'Remaining' stat visible:", remainingText);

// Rogue demo
await page.click('button:has-text("Fire Rogue Agent Demo")');
await page.waitForSelector("text=CIRCUIT BREAKER", { timeout: 15000 }).catch(() => console.log("Circuit breaker banner did not appear"));
await page.screenshot({ path: `${shotDir}/04-rogue.png`, fullPage: true });

// Reset
await page.click('button:has-text("Reset Demo")');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${shotDir}/05-reset.png`, fullPage: true });

console.log("Console errors captured:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 20)) console.log(" -", e);

await browser.close();
